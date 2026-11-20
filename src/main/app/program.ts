import { combine, next, type Program, route } from "../../shared/tea/program";
import * as Messages from "../features/messages/messages.program";

/** The whole of main's state. Each feature owns one slice and writes only that. */
export interface Model {
  readonly messages: Messages.Model;
}

export type Msg = Messages.Msg;

export type Cmd = Messages.Cmd;

export const program: Program<Model, Msg, Cmd> = {
  init: next({ messages: Messages.init }),
  update: combine<Model, Msg, Cmd>([
    route("messages", Messages.Msg, (msg, slice) => Messages.update(msg, slice)),
  ]),
};
