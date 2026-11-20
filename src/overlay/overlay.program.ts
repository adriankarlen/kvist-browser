import { Schema } from "effect";
import { OverlayIntent } from "../shared/rpc/overlay";
import {
  CompletionCandidate,
  CompletionInset,
  CompletionOverlayState,
} from "../shared/schema/completion";
import { next, type Next, type Program } from "../shared/tea/program";

/** A list's worth of state: the rows, and where main wants them drawn inside its view. */
export interface Model {
  readonly state: CompletionOverlayState | null;
  readonly inset: CompletionInset | null;
}

export const Msg = Schema.TaggedUnion({
  CompletionStateChanged: { state: CompletionOverlayState },
  CompletionInsetChanged: { inset: CompletionInset },
  CompletionCssChanged: { css: Schema.String },
  /** The unrounded height, so main need not model row styles. */
  ListMeasured: { height: Schema.Finite },
  RowClicked: { candidate: CompletionCandidate },
});

export type Msg = typeof Msg.Type;

export const Cmd = Schema.TaggedUnion({
  InjectCss: { css: Schema.String },
  SendToMain: { intent: OverlayIntent },
});

export type Cmd = typeof Cmd.Type;

const send = (intent: OverlayIntent): Cmd => Cmd.cases.SendToMain.make({ intent });

function update(msg: Msg, model: Model): Next<Model, never, Cmd> {
  return Msg.match(msg, {
    CompletionStateChanged: ({ state }) => next({ ...model, state }),
    CompletionInsetChanged: ({ inset }) => next({ ...model, inset }),
    CompletionCssChanged: ({ css }) => next(model, [Cmd.cases.InjectCss.make({ css })]),
    ListMeasured: ({ height }) =>
      next(model, [send(OverlayIntent.cases.CompletionMeasured.make({ height }))]),
    // The candidate itself, not its index: the click blurs the chrome's input,
    // which may clear its list before this arrives.
    RowClicked: ({ candidate }) =>
      next(model, [send(OverlayIntent.cases.CompletionClicked.make({ candidate }))]),
  });
}

export const program: Program<Model, Msg, Cmd> = {
  init: next({ state: null, inset: null }),
  update,
};
