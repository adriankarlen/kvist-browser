import { combine, next, type Program, routesFor } from "../../shared/tea/program";
import * as Bookmarks from "../features/bookmarks/bookmarks.program";
import * as Downloads from "../features/downloads/downloads.program";
import * as Layout from "../features/layout/layout.program";
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
  readonly layout: Layout.Model;
  readonly link: Link.Model;
  readonly main: Main.Model;
  readonly ui: Ui.Model;
}

export type Msg = Bookmarks.Msg | Downloads.Msg | Layout.Msg | Link.Msg | Main.Msg | Ui.Msg;

export type Cmd = Bookmarks.Cmd | Downloads.Cmd | Layout.Cmd | Link.Cmd;

const route = routesFor<Model, Msg, Cmd>();

export const program: Program<Model, Msg, Cmd> = {
  init: next({
    bookmarks: Bookmarks.init,
    downloads: Downloads.init,
    layout: Layout.init,
    link: Link.init,
    main: Main.init,
    ui: Ui.init,
  }),
  update: combine<Model, Msg, Cmd>([
    route("bookmarks", Bookmarks.Msg, Bookmarks.update),
    route("downloads", Downloads.Msg, Downloads.update),
    route("layout", Layout.Msg, Layout.update),
    route("link", Link.Msg, Link.update),
    route("main", Main.Msg, Main.update),
    route("ui", Ui.Msg, Ui.update),
  ]),
  keyOf: (cmd) => {
    if (Downloads.Cmd.guards.LingerDownloads(cmd)) return "downloads-linger";

    if (Bookmarks.Cmd.guards.FetchBookmarks(cmd)) return "bookmarks-fetch";

    if (Layout.Cmd.guards.PeekTabStrip(cmd)) return "tabstrip-peek";

    return undefined;
  },
};
