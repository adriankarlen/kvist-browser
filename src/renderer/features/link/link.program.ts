import { Schema } from "effect";
import { ChromeIntent } from "../../../shared/rpc/chrome";
import { CompletionCandidate } from "../../../shared/schema/completion";
import { next, type Next } from "../../../shared/tea/program";

/** The chrome's way out: to main, to the document, and to whichever input owns the overlay. */
export interface Model {
  readonly sent: number;
}

export const init: Model = { sent: 0 };

export const Msg = Schema.TaggedUnion({
  /** A button, a key or an input asked main for something. */
  IntentSent: { intent: ChromeIntent },
  /** Main asks the chrome to focus its own omnibox; main only moves window focus. */
  OmniboxFocusRequested: {},
  /** A row clicked in the overlay, relayed back by main. */
  CompletionPicked: { candidate: CompletionCandidate },
});

export type Msg = typeof Msg.Type;

export const Cmd = Schema.TaggedUnion({
  SendToMain: { intent: ChromeIntent },
  InjectCss: { css: Schema.String },
  FocusElement: { name: Schema.String },
  AcceptCompletion: { candidate: CompletionCandidate },
});

export type Cmd = typeof Cmd.Type;

export const send = (intent: ChromeIntent): Cmd => Cmd.cases.SendToMain.make({ intent });

export function update(msg: Msg, model: Model): Next<Model, never, Cmd> {
  return Msg.match(msg, {
    IntentSent: ({ intent }) => next({ sent: model.sent + 1 }, [send(intent)]),
    OmniboxFocusRequested: () => next(model, [Cmd.cases.FocusElement.make({ name: "omnibox" })]),
    CompletionPicked: ({ candidate }) =>
      next(model, [Cmd.cases.AcceptCompletion.make({ candidate })]),
  });
}
