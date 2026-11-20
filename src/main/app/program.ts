import { combine, next, type Program, routesFor } from "../../shared/tea/program";
import * as Downloads from "../features/downloads/downloads.program";
import * as Messages from "../features/messages/messages.program";
import * as Prompts from "../features/prompts/prompts.program";
import * as Tabs from "../features/tabs/tabs.program";
import * as Vim from "../features/vim/vim.program";

/** The whole of main's state. Each feature owns one slice and writes only that. */
export interface Model {
  readonly downloads: Downloads.Model;
  readonly messages: Messages.Model;
  readonly prompts: Prompts.Model;
  readonly tabs: Tabs.Model;
  readonly vim: Vim.Model;
}

export type Msg = Downloads.Msg | Messages.Msg | Prompts.Msg | Tabs.Msg | Vim.Msg;

export type Cmd = Downloads.Cmd | Messages.Cmd | Prompts.Cmd | Tabs.Cmd | Vim.Cmd;

const route = routesFor<Model, Msg, Cmd>();

export const program: Program<Model, Msg, Cmd> = {
  init: next({
    downloads: Downloads.init,
    messages: Messages.init,
    prompts: Prompts.init,
    tabs: Tabs.init,
    vim: Vim.init,
  }),
  update: combine<Model, Msg, Cmd>([
    route("downloads", Downloads.Msg, Downloads.update),
    route("messages", Messages.Msg, Messages.update),
    route("prompts", Prompts.Msg, Prompts.update),
    route("tabs", Tabs.Msg, Tabs.update),
    route("vim", Vim.Msg, Vim.update),
  ]),
};
