import { Schema } from "effect";
import { TabOrientation } from "../../../shared/schema/config";
import { next, type Next } from "../../../shared/tea/program";
import { clamp } from "../../zoom";
import { type Msg as MessagesMsg, say } from "../messages/messages.program";

/**
 * What the user keeps between launches, as far as the loop needs to read
 * it on the spot: which URLs are bookmarked (for the strip's star) and each
 * origin's zoom (applied on every navigation). Writes leave as Cmds.
 */
export interface Model {
  readonly bookmarked: ReadonlySet<string>;
  readonly zoom: ReadonlyMap<string, number>;
}

export const init: Model = { bookmarked: new Set(), zoom: new Map() };

const SessionState = Schema.Struct({
  tabs: Schema.Array(Schema.String),
  activeIndex: Schema.Int,
  width: Schema.Int,
  height: Schema.Int,
  x: Schema.NullOr(Schema.Int),
  y: Schema.NullOr(Schema.Int),
  orientation: Schema.NullOr(TabOrientation),
});

export const Msg = Schema.TaggedUnion({
  LibraryLoaded: {
    bookmarked: Schema.Array(Schema.String),
    zoom: Schema.Array(Schema.Tuple([Schema.String, Schema.Finite])),
  },
  BookmarksChanged: { bookmarked: Schema.Array(Schema.String) },
  /** A committed main-frame load. The title at commit time is still the last page's. */
  VisitCommitted: { url: Schema.String, at: Schema.Finite },
  /** Bookmark the page, or remove every bookmark it already has. */
  BookmarkToggled: { url: Schema.String, title: Schema.String },
  /** One row deleted from the bookmarks panel; other rows for the same URL stay. */
  BookmarkRemoveRequested: { id: Schema.Int },
  ZoomChanged: { origin: Schema.String, level: Schema.Finite },
  /** The window closing with tabs open: the next launch restores them. */
  SessionClosed: { state: SessionState, at: Schema.Finite },
  /** Closing everything means the next launch looks like a first launch. */
  SessionEmptied: {},
});

export type Msg = typeof Msg.Type;

export const Cmd = Schema.TaggedUnion({
  RecordVisit: { url: Schema.String, at: Schema.Finite },
  AddBookmark: { url: Schema.String, title: Schema.String },
  RemoveBookmarks: { url: Schema.String },
  RemoveBookmark: { id: Schema.Int },
  SaveZoom: { origin: Schema.String, level: Schema.Finite },
  SaveSession: { state: SessionState, at: Schema.Finite },
  ClearSession: {},
});

export type Cmd = typeof Cmd.Type;

export function update(msg: Msg, model: Model): Next<Model, MessagesMsg, Cmd> {
  return Msg.match(msg, {
    LibraryLoaded: ({ bookmarked, zoom }) =>
      next({ bookmarked: new Set(bookmarked), zoom: new Map(zoom) }),
    BookmarksChanged: ({ bookmarked }) => next({ ...model, bookmarked: new Set(bookmarked) }),
    VisitCommitted: ({ url, at }) => next(model, [Cmd.cases.RecordVisit.make({ url, at })]),
    BookmarkToggled: ({ url, title }) =>
      model.bookmarked.has(url)
        ? next(model, [Cmd.cases.RemoveBookmarks.make({ url })], [say(`removed bookmark ${url}`)])
        : // A page that never set a title has nothing better than its URL.
          next(model, [Cmd.cases.AddBookmark.make({ url, title: title.trim() || url })]),
    BookmarkRemoveRequested: ({ id }) => next(model, [Cmd.cases.RemoveBookmark.make({ id })]),
    ZoomChanged: ({ origin, level }) => {
      const clamped = clamp(level);

      return next({ ...model, zoom: new Map(model.zoom).set(origin, clamped) }, [
        Cmd.cases.SaveZoom.make({ origin, level: clamped }),
      ]);
    },
    SessionClosed: ({ state, at }) => next(model, [Cmd.cases.SaveSession.make({ state, at })]),
    SessionEmptied: () => next(model, [Cmd.cases.ClearSession.make({})]),
  });
}
