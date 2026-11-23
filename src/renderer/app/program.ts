import { combine, next, type Program, routesFor } from "../../shared/tea/program";
import * as Bookmarks from "../features/bookmarks/bookmarks.program";
import * as Downloads from "../features/downloads/downloads.program";
import * as Link from "../features/link/link.program";
import * as Main from "../features/main/main.program";
import * as Ui from "../features/ui/ui.program";

/**
 * The chrome's whole state. Every event main sends is itself a Msg here,
 * owned by the feature that renders it.
 */
export interface Model {
  readonly bookmarks: Bookmarks.Model;
  readonly downloads: Downloads.Model;
  readonly link: Link.Model;
  readonly main: Main.Model;
  readonly ui: Ui.Model;
}

export type Msg = Bookmarks.Msg | Downloads.Msg | Link.Msg | Main.Msg | Ui.Msg;

export type Cmd = Bookmarks.Cmd | Downloads.Cmd | Link.Cmd;

const route = routesFor<Model, Msg, Cmd>();

export const program: Program<Model, Msg, Cmd> = {
  init: next({
    bookmarks: Bookmarks.init,
    downloads: Downloads.init,
    link: Link.init,
    main: Main.init,
    ui: Ui.init,
  }),
  update: combine<Model, Msg, Cmd>([
    route("bookmarks", Bookmarks.Msg, Bookmarks.update),
    route("downloads", Downloads.Msg, Downloads.update),
    route("link", Link.Msg, Link.update),
    route("main", Main.Msg, Main.update),
    route("ui", Ui.Msg, Ui.update),
  ]),
  keyOf: (cmd) => {
    if (Downloads.Cmd.guards.LingerDownloads(cmd)) return "downloads-linger";

    if (Bookmarks.Cmd.guards.FetchBookmarks(cmd)) return "bookmarks-fetch";

    return undefined;
  },
};
