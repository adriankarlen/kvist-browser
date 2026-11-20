import { combine, next, type Program, routesFor } from "../../shared/tea/program";
import * as Messages from "../features/messages/messages.program";
import * as Prompts from "../features/prompts/prompts.program";

/** The whole of main's state. Each feature owns one slice and writes only that. */
export interface Model {
  readonly messages: Messages.Model;
  readonly prompts: Prompts.Model;
}

export type Msg = Messages.Msg | Prompts.Msg;

export type Cmd = Messages.Cmd | Prompts.Cmd;

const route = routesFor<Model, Msg, Cmd>();

export const program: Program<Model, Msg, Cmd> = {
  init: next({ messages: Messages.init, prompts: Prompts.init }),
  update: combine<Model, Msg, Cmd>([
    route("messages", Messages.Msg, Messages.update),
    route("prompts", Prompts.Msg, Prompts.update),
  ]),
};
