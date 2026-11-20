import { Schema } from "effect";
import { Message } from "../../../shared/schema/browser";
import { next, type Next } from "../../../shared/tea/program";

/**
 * The echo area, Neovim-style: one message at a time, standing until the
 * user does something else. Not a timer: a message that leaves on its own
 * can leave before it is read.
 */
export interface Model {
  readonly current: Message | null;
}

export const init: Model = { current: null };

export const Msg = Schema.TaggedUnion({
  MessageShown: { message: Message },
  /** Any key at all ends what the echo area shows. */
  MessageDismissed: {},
});

export type Msg = typeof Msg.Type;

export const Cmd = Schema.TaggedUnion({
  /** Everything said also reaches the log, which is where a bug report comes from. */
  LogMessage: { message: Message },
});

export type Cmd = typeof Cmd.Type;

export const say = (text: string): Msg =>
  Msg.cases.MessageShown.make({ message: { text, level: "info" } });

export const warn = (text: string): Msg =>
  Msg.cases.MessageShown.make({ message: { text, level: "error" } });

export function update(msg: Msg, model: Model): Next<Model, never, Cmd> {
  return Msg.match(msg, {
    MessageShown: ({ message }) =>
      next({ current: message }, [Cmd.cases.LogMessage.make({ message })]),
    MessageDismissed: () => (model.current === null ? next(model) : next({ current: null })),
  });
}
