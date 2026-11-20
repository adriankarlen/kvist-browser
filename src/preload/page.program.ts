import { Schema } from "effect";
import { PageIntent } from "../shared/rpc/page";
import { ScrollCommand } from "../shared/schema/browser";
import { ContextMenuState } from "../shared/schema/context-menu";
import { next, type Next, type Program } from "../shared/tea/program";

/** The keys hint labels are made of: the home row. */
export const HINT_ALPHABET = "asdfghjkl";

/**
 * The page's half of vim. Hint mode is a state machine of its own: which
 * labels are up, and what has been typed. The markers and their elements
 * stay in the DOM, where the effects find them.
 */
export interface Model {
  readonly hints: { readonly labels: ReadonlyArray<string>; readonly typed: string } | null;
  /** Whether the focused element takes typing, as last reported to main. */
  readonly editable: boolean | null;
}

export const Msg = Schema.TaggedUnion({
  BlurRequested: {},
  ScrollRequested: { command: ScrollCommand },
  HintsShown: {},
  HintKeyPressed: { key: Schema.String },
  HintsHidden: {},
  ContextMenuChanged: { menu: Schema.NullOr(ContextMenuState) },
  /** The markers are up, one label per target; none means nothing to hint. */
  HintsRendered: { labels: Schema.Array(Schema.String) },
  /** Anything that moves the page leaves the markers pointing at the wrong things. */
  PageScrolled: {},
  FocusChanged: { editable: Schema.Boolean },
  /** The menu closed, with the picked item's id or null. */
  MenuClosed: { id: Schema.NullOr(Schema.String) },
});

export type Msg = typeof Msg.Type;

export const Cmd = Schema.TaggedUnion({
  BlurFocused: {},
  Scroll: { command: ScrollCommand },
  RenderHints: {},
  DimHints: { typed: Schema.String },
  /** Hide the markers first, so they cannot intercept the click. */
  ActivateHint: { label: Schema.String },
  HideHints: {},
  ShowMenu: { menu: ContextMenuState },
  HideMenu: {},
  SendToMain: { intent: PageIntent },
});

export type Cmd = typeof Cmd.Type;

const C = Cmd.cases;
const send = (intent: PageIntent): Cmd => C.SendToMain.make({ intent });
const ended = send(PageIntent.cases.HintsEnded.make({}));

type Result = Next<Model, never, Cmd>;

function hintKey(model: Model, key: string): Result {
  const hints = model.hints;

  if (hints === null) return next(model);
  let typed: string;

  if (key === "Backspace") typed = hints.typed.slice(0, -1);
  else if (HINT_ALPHABET.includes(key)) typed = hints.typed + key;
  else return next(model);

  const matches = hints.labels.filter((label) => label.startsWith(typed));

  if (matches.length === 0) return next({ ...model, hints: null }, [C.HideHints.make({}), ended]);

  // Labels are fixed width, so a single match on a full-length prefix is the one.
  if (matches.length === 1 && matches[0] === typed) {
    return next({ ...model, hints: null }, [C.ActivateHint.make({ label: typed }), ended]);
  }

  return next({ ...model, hints: { ...hints, typed } }, [C.DimHints.make({ typed })]);
}

function update(msg: Msg, model: Model): Result {
  return Msg.match(msg, {
    BlurRequested: () => next(model, [C.BlurFocused.make({})]),
    ScrollRequested: ({ command }) => next(model, [C.Scroll.make({ command })]),
    HintsShown: () => next(model, [C.RenderHints.make({})]),
    HintsRendered: ({ labels }) =>
      labels.length === 0
        ? next({ ...model, hints: null }, [ended])
        : next({ ...model, hints: { labels, typed: "" } }),
    HintKeyPressed: ({ key }) => hintKey(model, key),
    HintsHidden: () => next({ ...model, hints: null }, [C.HideHints.make({})]),
    PageScrolled: () =>
      model.hints === null
        ? next(model)
        : next({ ...model, hints: null }, [C.HideHints.make({}), ended]),
    ContextMenuChanged: ({ menu }) =>
      next(model, [menu === null ? C.HideMenu.make({}) : C.ShowMenu.make({ menu })]),
    FocusChanged: ({ editable }) =>
      editable === model.editable
        ? next(model)
        : next({ ...model, editable }, [send(PageIntent.cases.EditableChanged.make({ editable }))]),
    MenuClosed: ({ id }) => next(model, [send(PageIntent.cases.ContextMenuPicked.make({ id }))]),
  });
}

export const program: Program<Model, Msg, Cmd> = {
  init: next({ hints: null, editable: null }),
  update,
};
