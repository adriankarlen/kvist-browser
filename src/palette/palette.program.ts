import { Schema } from "effect";
import { PaletteIntent } from "../shared/rpc/palette";
import { CompletionCandidate } from "../shared/schema/completion";
import { next, type Next, type Program } from "../shared/tea/program";

/** The latest opening main announced. The draft is the input's own, as in the omnibox. */
export interface Opening {
  readonly text: string;
  readonly seq: number;
  readonly size: string | undefined;
}

export interface Model {
  readonly opening: Opening | null;
}

export const Msg = Schema.TaggedUnion({
  Opened: {
    text: Schema.String,
    seq: Schema.Int,
    size: Schema.UndefinedOr(Schema.String),
  },
  CssChanged: { css: Schema.String },
  /** Enter on what was typed, with nothing picked. */
  DraftSubmitted: { draft: Schema.String },
  RowAccepted: { candidate: CompletionCandidate },
  /** Escape, or a click beside the panel. */
  DismissRequested: {},
});

export type Msg = typeof Msg.Type;

export const Cmd = Schema.TaggedUnion({
  InjectCss: { css: Schema.String },
  SendToMain: { intent: PaletteIntent },
});

export type Cmd = typeof Cmd.Type;

const I = PaletteIntent.cases;
const send = (intent: PaletteIntent): Cmd => Cmd.cases.SendToMain.make({ intent });

/** A leading colon turns the palette into the command line. */
export const commandOf = (draft: string): string | null =>
  draft.startsWith(":") ? draft.slice(1) : null;

function submit(draft: string): PaletteIntent {
  const line = commandOf(draft);

  return line === null ? I.Submitted.make({ text: draft }) : I.CommandEntered.make({ line });
}

function update(msg: Msg, model: Model): Next<Model, never, Cmd> {
  return Msg.match(msg, {
    Opened: ({ text, seq, size }) => next({ opening: { text, seq, size } }),
    CssChanged: ({ css }) => next(model, [Cmd.cases.InjectCss.make({ css })]),
    DraftSubmitted: ({ draft }) => next(model, [send(submit(draft))]),
    RowAccepted: ({ candidate }) => next(model, [send(I.SuggestionPicked.make({ candidate }))]),
    DismissRequested: () => next(model, [send(I.Dismissed.make({}))]),
  });
}

export const program: Program<Model, Msg, Cmd> = {
  init: next({ opening: null }),
  update,
};
