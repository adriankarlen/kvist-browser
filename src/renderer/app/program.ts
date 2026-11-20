import { combine, next, type Program, routesFor } from "../../shared/tea/program";
import * as Downloads from "../features/downloads/downloads.program";
import * as Link from "../features/link/link.program";
import * as Main from "../features/main/main.program";
import * as Ui from "../features/ui/ui.program";

/**
 * The chrome's whole state. Every event main sends is itself a Msg here,
 * owned by the feature that renders it.
 */
export interface Model {
  readonly downloads: Downloads.Model;
  readonly link: Link.Model;
  readonly main: Main.Model;
  readonly ui: Ui.Model;
}

export type Msg = Downloads.Msg | Link.Msg | Main.Msg | Ui.Msg;

export type Cmd = Downloads.Cmd | Link.Cmd;

const route = routesFor<Model, Msg, Cmd>();

export const program: Program<Model, Msg, Cmd> = {
  init: next({ downloads: Downloads.init, link: Link.init, main: Main.init, ui: Ui.init }),
  update: combine<Model, Msg, Cmd>([
    route("downloads", Downloads.Msg, Downloads.update),
    route("link", Link.Msg, Link.update),
    route("main", Main.Msg, Main.update),
    route("ui", Ui.Msg, Ui.update),
  ]),
  keyOf: (cmd) => (Downloads.Cmd.guards.LingerDownloads(cmd) ? "downloads-linger" : undefined),
};
