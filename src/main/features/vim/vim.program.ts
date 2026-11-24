import { Schema } from "effect";
import { Mode } from "../../../shared/schema/browser";
import { InputMode } from "../../../shared/schema/config";
import { Binding, type KeyTable } from "../../../shared/schema/keymap";
import { next, type Next } from "../../../shared/tea/program";
import { type Msg as MessagesMsg, Msg as MessagesMsgs } from "../messages/messages.program";
import { isModified, isModifierKey, type KeyInput, matchesKey } from "./keybinds";
import { buildKeymap } from "./keymap";

export type { KeyInput } from "./keybinds";

/**
 * Which webContents a key came from. `before-input-event` is per
 * webContents, so the page and the chrome are two sources with different
 * rules.
 */
export const KeySource = Schema.Literals(["page", "chrome"]);

export type KeySource = typeof KeySource.Type;

export interface Model {
  /** Which engine is live, from the preset `[input] mode` names. */
  readonly scheme: InputMode;
  readonly keymap: ReadonlyArray<Binding>;
  readonly mode: Mode;
  /** The keys typed so far of a longer binding, like the `g` of `gt`. */
  readonly pending: ReadonlyArray<KeyInput>;
  /** A question waiting for an answer owns normal mode while it lasts. */
  readonly promptPending: boolean;
}

export const init: Model = {
  scheme: "vim",
  keymap: buildKeymap("vim", []).bindings,
  mode: "normal",
  pending: [],
  promptPending: false,
};

export const Msg = Schema.TaggedUnion({
  KeyPressed: {
    key: Schema.String,
    code: Schema.String,
    control: Schema.Boolean,
    alt: Schema.Boolean,
    meta: Schema.Boolean,
    shift: Schema.Boolean,
    source: KeySource,
  },
  /** The chrome asking, e.g. Escape out of the command line. */
  ModeRequested: { mode: Mode },
  /** A tab's focus moved on or off something typable. */
  EditableChanged: { editable: Schema.Boolean },
  /** The page reporting that hinting ended. */
  HintsEnded: {},
  PromptPendingChanged: { pending: Schema.Boolean },
  /** A chrome input closed but kept the keyboard, e.g. the window lost focus. */
  ChromeInputClosed: {},
  KeymapChanged: { scheme: InputMode, keymap: Schema.Array(Binding) },
});

export type Msg = typeof Msg.Type;

export const Cmd = Schema.TaggedUnion({
  RunCommand: { name: Schema.String, arg: Schema.UndefinedOr(Schema.String) },
});

export type Cmd = typeof Cmd.Type;

type Result = Next<Model, MessagesMsg, Cmd>;

const run = (name: string, arg?: string): Cmd => Cmd.cases.RunCommand.make({ name, arg });

/**
 * A pending question turns normal into prompt, wherever the transition came
 * from: an answered prompt with another queued behind it keeps the mode.
 * Standard mode answers with buttons, so its keys stay with the page.
 */
function enter(model: Model, mode: Mode): Model {
  const capture = mode === "normal" && model.promptPending && model.scheme === "vim";
  const target = capture ? "prompt" : mode;

  return target === model.mode ? model : { ...model, mode: target, pending: [] };
}

/** Modes where a chrome text input is open and owns every key it can type. */
const prompting = (model: Model): boolean => model.mode === "command" || model.mode === "find";

interface Dispatched {
  readonly model: Model;
  readonly consumed: boolean;
  readonly cmds: ReadonlyArray<Cmd>;
}

const passed = (model: Model): Dispatched => ({ model, consumed: false, cmds: [] });

const tableOf = (model: Model, table: KeyTable | Mode): ReadonlyArray<Binding> =>
  model.keymap.filter((binding) => binding.table === table);

const matchesFrom = (binding: Binding, sequence: ReadonlyArray<KeyInput>): boolean =>
  sequence.every((input, i) => {
    const key = binding.keys[i];

    return key !== undefined && matchesKey(key, input);
  });

function fire(model: Model, binding: Binding): Dispatched {
  const cleared = { ...model, pending: [] };
  const entered = binding.enter === undefined ? cleared : enter(cleared, binding.enter);

  return { model: entered, consumed: true, cmds: [run(binding.command, binding.arg)] };
}

function dispatchKey(model: Model, input: KeyInput, table: ReadonlyArray<Binding>): Dispatched {
  const sequence = [...model.pending, input];
  const reached = table.filter((binding) => matchesFrom(binding, sequence));
  const match = reached.find((binding) => binding.keys.length === sequence.length);

  if (match !== undefined) return fire(model, match);

  if (reached.length > 0)
    return { model: { ...model, pending: sequence }, consumed: true, cmds: [] };

  // A held key nothing here wants belongs to the page or the menu, and leaves a prefix waiting.
  if (isModified(input)) return passed(model);

  // An unknown sequence following a prefix is swallowed rather than leaked.
  if (model.pending.length > 0)
    return { model: { ...model, pending: [] }, consumed: true, cmds: [] };

  return passed(model);
}

/** A chord runs its command from any mode and either webContents, so it works while typing. */
function dispatchChord(model: Model, input: KeyInput): Dispatched | undefined {
  const chord = tableOf(model, "chords").find((binding) => matchesFrom(binding, [input]));

  return chord === undefined ? undefined : fire(model, chord);
}

/** One key against the mode machine. Pure, so the interceptor can ask it on the same tick. */
export function step(model: Model, input: KeyInput, source: KeySource): Dispatched {
  const chord = dispatchChord(model, input);

  if (chord !== undefined) return chord;

  // Every key belongs to a question or to hinting while it is up, but a bare
  // modifier is only on its way to one: it must not break a `g` before `T`.
  if (isModifierKey(input.key)) {
    return { model, consumed: model.mode === "hint" || model.mode === "prompt", cmds: [] };
  }

  // Chrome inputs own every key they can type, and their own Escape.
  if (
    source === "chrome" &&
    model.mode !== "normal" &&
    model.mode !== "hint" &&
    model.mode !== "prompt"
  ) {
    return passed(model);
  }

  // The prompts live in the chrome, so a page that still has focus must not steal from them.
  if (source === "page" && prompting(model)) return passed(model);

  const table = tableOf(model, model.mode);
  const dispatched = dispatchKey(model, input, table);

  if (dispatched.consumed || isModified(input)) return dispatched;

  // Every key belongs to hinting while it is up; the page decides when a label matched.
  if (model.mode === "hint") return { model, consumed: true, cmds: [run("hints.key", input.key)] };

  // A question owns every other key until it is answered.
  if (model.mode === "prompt") return { model, consumed: true, cmds: [] };

  return dispatched;
}

/** Standard mode: chords only. Every other key is left alone. */
export const stepStandard = (model: Model, input: KeyInput): Dispatched =>
  dispatchChord(model, input) ?? passed(model);

const stepScheme = (model: Model, input: KeyInput, source: KeySource): Dispatched =>
  model.scheme === "vim" ? step(model, input, source) : stepStandard(model, input);

/** Whether a key must be kept from its webContents. */
export const resolveKey = (model: Model, input: KeyInput, source: KeySource): boolean =>
  stepScheme(model, input, source).consumed;

/** Hint and prompt exist only in vim; the typing modes follow focus, so they stay. */
function changeKeymap(model: Model, scheme: InputMode, keymap: ReadonlyArray<Binding>): Result {
  const rebound = { ...model, keymap, pending: [] };

  if (scheme === model.scheme) return next(rebound);
  const modal = model.mode === "hint" || model.mode === "prompt";
  const switched = enter({ ...rebound, scheme }, modal ? "normal" : model.mode);

  return next(switched, model.mode === "hint" ? [run("hints.hide")] : []);
}

export function update(msg: Msg, model: Model): Result {
  return Msg.match(msg, {
    KeyPressed: ({ source, ...input }) => {
      const stepped = stepScheme(model, input, source);

      // Any key at all ends what the echo area shows, wherever it came from.
      return next(stepped.model, stepped.cmds, [MessagesMsgs.cases.MessageDismissed.make({})]);
    },
    ModeRequested: ({ mode }) =>
      next(enter(model, mode), mode === "normal" ? [run("focus.page")] : []),
    EditableChanged: ({ editable }) => {
      // A chrome prompt or a question holds the keyboard; the page is a bystander.
      if (prompting(model) || model.mode === "prompt") return next(model);

      if (editable) return next(enter(model, "insert"));

      return next(model.mode === "insert" ? enter(model, "normal") : model);
    },
    // Selecting a field focuses it, which enters insert first; only hint mode unwinds here.
    HintsEnded: () => next(model.mode === "hint" ? enter(model, "normal") : model),
    // Its typing mode ends with it, but focus stays where the user put it.
    ChromeInputClosed: () =>
      next(prompting(model) || model.mode === "insert" ? enter(model, "normal") : model),
    KeymapChanged: ({ scheme, keymap }) => changeKeymap(model, scheme, keymap),
    PromptPendingChanged: ({ pending }) => {
      const flagged = { ...model, promptPending: pending };

      if (model.scheme === "standard") return next(flagged);

      if (pending && model.mode === "normal") return next(enter(flagged, "prompt"));

      if (!pending && model.mode === "prompt") return next(enter(flagged, "normal"));

      return next(flagged);
    },
  });
}
