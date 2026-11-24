import { Schema } from "effect";
import { Mode } from "../../../shared/schema/browser";
import { InputMode } from "../../../shared/schema/config";
import { next, type Next } from "../../../shared/tea/program";
import { type Msg as MessagesMsg, Msg as MessagesMsgs } from "../messages/messages.program";
import {
  type Chord,
  DEFAULT_KEYBINDS,
  findChord,
  type Keybind,
  STANDARD_KEYBINDS,
} from "./keybinds";

export interface KeyInput {
  readonly key: string;
  /** The physical key, e.g. `KeyI`. macOS turns Alt+letter into another character. */
  readonly code: string;
  readonly control: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}

/**
 * Which webContents a key came from. `before-input-event` is per
 * webContents, so the page and the chrome are two sources with different
 * rules.
 */
export const KeySource = Schema.Literals(["page", "chrome"]);

export type KeySource = typeof KeySource.Type;

export interface Model {
  /** Which key set is live, from `[input] mode`. */
  readonly scheme: InputMode;
  readonly mode: Mode;
  /** The keys typed so far of a longer binding, like the `g` of `gt`. */
  readonly pending: string;
  /** A question waiting for an answer owns normal mode while it lasts. */
  readonly promptPending: boolean;
}

export const init: Model = { scheme: "vim", mode: "normal", pending: "", promptPending: false };

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
  InputModeChanged: { scheme: InputMode },
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

  return target === model.mode ? model : { ...model, mode: target, pending: "" };
}

/** Modes where a chrome text input is open and owns every key it can type. */
const prompting = (model: Model): boolean => model.mode === "command" || model.mode === "find";

interface Dispatched {
  readonly model: Model;
  readonly consumed: boolean;
  readonly cmds: ReadonlyArray<Cmd>;
}

function dispatchKey(model: Model, key: string, keybinds: ReadonlyArray<Keybind>): Dispatched {
  const sequence = model.pending + key;
  const match = keybinds.find((bind) => bind.mode === model.mode && bind.keys === sequence);

  if (match !== undefined) {
    const cleared = { ...model, pending: "" };
    const entered = match.enter === undefined ? cleared : enter(cleared, match.enter);

    return {
      model: entered,
      consumed: true,
      cmds: match.command ? [run(match.command, match.arg)] : [],
    };
  }

  const isPrefix = keybinds.some(
    (bind) =>
      bind.mode === model.mode &&
      bind.keys.startsWith(sequence) &&
      bind.keys.length > sequence.length,
  );

  if (isPrefix) return { model: { ...model, pending: sequence }, consumed: true, cmds: [] };

  // An unknown sequence following a prefix is swallowed rather than leaked.
  if (model.pending !== "") return { model: { ...model, pending: "" }, consumed: true, cmds: [] };

  return { model, consumed: false, cmds: [] };
}

/** One key against the mode machine. Pure, so the interceptor can ask it on the same tick. */
export function step(
  model: Model,
  input: KeyInput,
  source: KeySource,
  keybinds: ReadonlyArray<Keybind> = DEFAULT_KEYBINDS,
): Dispatched {
  const passed = { model, consumed: false, cmds: [] };

  if (input.control || input.alt || input.meta) return passed;

  // Chrome inputs own every key they can type, and their own Escape.
  if (
    source === "chrome" &&
    model.mode !== "normal" &&
    model.mode !== "hint" &&
    model.mode !== "prompt"
  ) {
    return passed;
  }

  // The prompts live in the chrome, so a page that still has focus must not steal from them.
  if (source === "page" && prompting(model)) return passed;

  const dispatched = dispatchKey(model, input.key, keybinds);

  if (dispatched.consumed) return dispatched;

  // Every key belongs to hinting while it is up; the page decides when a label matched.
  if (model.mode === "hint") return { model, consumed: true, cmds: [run("hints.key", input.key)] };

  // A question owns every other key until it is answered.
  if (model.mode === "prompt") return { model, consumed: true, cmds: [] };

  return passed;
}

/**
 * Standard mode: a chord runs its command from any mode and either
 * webContents, so Mod+T works while typing. Every other key is left alone.
 */
export function stepStandard(
  model: Model,
  input: KeyInput,
  chords: ReadonlyArray<Chord> = STANDARD_KEYBINDS,
): Dispatched {
  const chord = findChord(chords, input);

  if (chord === undefined) return { model, consumed: false, cmds: [] };
  const entered = chord.enter === undefined ? model : enter(model, chord.enter);

  return { model: entered, consumed: true, cmds: [run(chord.command, chord.arg)] };
}

const stepScheme = (model: Model, input: KeyInput, source: KeySource): Dispatched =>
  model.scheme === "vim" ? step(model, input, source) : stepStandard(model, input);

/** Whether a key must be kept from its webContents. */
export const resolveKey = (model: Model, input: KeyInput, source: KeySource): boolean =>
  stepScheme(model, input, source).consumed;

/** Hint and prompt exist only in vim; the typing modes follow focus, so they stay. */
function switchScheme(model: Model, scheme: InputMode): Result {
  if (scheme === model.scheme) return next(model);
  const modal = model.mode === "hint" || model.mode === "prompt";
  const switched = enter({ ...model, scheme, pending: "" }, modal ? "normal" : model.mode);

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
    InputModeChanged: ({ scheme }) => switchScheme(model, scheme),
    PromptPendingChanged: ({ pending }) => {
      const flagged = { ...model, promptPending: pending };

      if (model.scheme === "standard") return next(flagged);

      if (pending && model.mode === "normal") return next(enter(flagged, "prompt"));

      if (!pending && model.mode === "prompt") return next(enter(flagged, "normal"));

      return next(flagged);
    },
  });
}
