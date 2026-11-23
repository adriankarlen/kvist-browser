import { combine, next, type Program, routesFor } from "../../shared/tea/program";
import * as Completion from "../features/completion/completion.program";
import * as Config from "../features/config/config.program";
import * as Downloads from "../features/downloads/downloads.program";
import * as Library from "../features/library/library.program";
import * as Messages from "../features/messages/messages.program";
import * as Palette from "../features/palette/palette.program";
import * as Prompts from "../features/prompts/prompts.program";
import * as Tabs from "../features/tabs/tabs.program";
import * as Vim from "../features/vim/vim.program";

/** The whole of main's state. Each feature owns one slice and writes only that. */
export interface Model {
  readonly completion: Completion.Model;
  readonly config: Config.Model;
  readonly downloads: Downloads.Model;
  readonly library: Library.Model;
  readonly messages: Messages.Model;
  readonly palette: Palette.Model;
  readonly prompts: Prompts.Model;
  readonly tabs: Tabs.Model;
  readonly vim: Vim.Model;
}

export type Msg =
  | Completion.Msg
  | Config.Msg
  | Downloads.Msg
  | Library.Msg
  | Messages.Msg
  | Palette.Msg
  | Prompts.Msg
  | Tabs.Msg
  | Vim.Msg;

export type Cmd =
  | Config.Cmd
  | Downloads.Cmd
  | Library.Cmd
  | Messages.Cmd
  | Prompts.Cmd
  | Tabs.Cmd
  | Vim.Cmd;

const route = routesFor<Model, Msg, Cmd>();

export const program: Program<Model, Msg, Cmd> = {
  init: next({
    completion: Completion.init,
    config: Config.init,
    downloads: Downloads.init,
    library: Library.init,
    messages: Messages.init,
    palette: Palette.init,
    prompts: Prompts.init,
    tabs: Tabs.init,
    vim: Vim.init,
  }),
  update: combine<Model, Msg, Cmd>([
    route("completion", Completion.Msg, Completion.update),
    route("config", Config.Msg, Config.update),
    route("downloads", Downloads.Msg, Downloads.update),
    route("library", Library.Msg, Library.update),
    route("messages", Messages.Msg, Messages.update),
    route("palette", Palette.Msg, Palette.update),
    route("prompts", Prompts.Msg, Prompts.update),
    route("tabs", Tabs.Msg, Tabs.update),
    route("vim", Vim.Msg, Vim.update),
  ]),
};
