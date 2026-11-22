import { Schema } from "effect";
import { ChromeIntent } from "../../../shared/rpc/chrome";
import { Bookmark } from "../../../shared/schema/bookmarks";
import { next, type Next } from "../../../shared/tea/program";
import { type Cmd as LinkCmd, send } from "../link/link.program";

/** How long typing must pause before the filter asks main for rows. */
export const DEBOUNCE = "75 millis";

/** A picker over the saved bookmarks: a filter, the rows it matches, and one selected. */
export interface Model {
  readonly open: boolean;
  readonly query: string;
  readonly rows: ReadonlyArray<Bookmark>;
  readonly selected: number;
  /** Counts openings, so a second `:bookmarks` while open still refocuses the filter. */
  readonly opened: number;
}

export const init: Model = { open: false, query: "", rows: [], selected: 0, opened: 0 };

/** No id means the selected row: the keyboard acts on it, the mouse names one. */
const Target = { id: Schema.UndefinedOr(Schema.Int) };

export const Msg = Schema.TaggedUnion({
  BookmarksOpenRequested: {},
  BookmarksChanged: {},
  BookmarksQueryChanged: { query: Schema.String },
  BookmarksFetched: { query: Schema.String, rows: Schema.Array(Bookmark) },
  BookmarkSelectionMoved: { by: Schema.Int },
  BookmarkPicked: Target,
  BookmarkDeleteRequested: Target,
  BookmarksDismissed: {},
  /** The filter lost focus. Leaving the window blurs it too, and that must not move focus. */
  BookmarksBlurred: { chromeFocused: Schema.Boolean },
});

export type Msg = typeof Msg.Type;

export const Cmd = Schema.TaggedUnion({
  /** Keyed: a newer query interrupts an older one, debounce included. */
  FetchBookmarks: { query: Schema.String },
});

export type Cmd = typeof Cmd.Type;

const I = ChromeIntent.cases;

const fetch = (query: string): Cmd => Cmd.cases.FetchBookmarks.make({ query });
const toNormal = (): LinkCmd => send(I.ModeRequested.make({ mode: "normal" }));
const closed = (model: Model): Model => ({ ...model, open: false, query: "", rows: [] });

function clampSelection(selected: number, rows: ReadonlyArray<Bookmark>): number {
  return Math.max(0, Math.min(selected, rows.length - 1));
}

function target(model: Model, id: number | undefined): Bookmark | undefined {
  return id === undefined ? model.rows[model.selected] : model.rows.find((row) => row.id === id);
}

export function update(msg: Msg, model: Model): Next<Model, never, Cmd | LinkCmd> {
  return Msg.match(msg, {
    BookmarksOpenRequested: () =>
      next({ open: true, query: "", rows: model.rows, selected: 0, opened: model.opened + 1 }, [
        fetch(""),
      ]),
    BookmarksChanged: () => (model.open ? next(model, [fetch(model.query)]) : next(model)),
    BookmarksQueryChanged: ({ query }) =>
      model.open ? next({ ...model, query, selected: 0 }, [fetch(query)]) : next(model),
    BookmarksFetched: ({ query, rows }) =>
      model.open && query === model.query
        ? next({ ...model, rows, selected: clampSelection(model.selected, rows) })
        : next(model),
    BookmarkSelectionMoved: ({ by }) => {
      const count = model.rows.length;

      if (count === 0) return next(model);

      return next({ ...model, selected: (((model.selected + by) % count) + count) % count });
    },
    BookmarkPicked: ({ id }) => {
      const row = model.open ? target(model, id) : undefined;

      if (row === undefined) return next(model);

      return next(closed(model), [send(I.NavigationRequested.make({ url: row.url })), toNormal()]);
    },
    // Dropped here before main confirms, so a click feels instant; the
    // refetch that main's change triggers settles what is really left.
    BookmarkDeleteRequested: ({ id }) => {
      const row = model.open ? target(model, id) : undefined;

      if (row === undefined) return next(model);
      const rows = model.rows.filter((entry) => entry.id !== row.id);

      return next({ ...model, rows, selected: clampSelection(model.selected, rows) }, [
        send(I.BookmarkRemoveRequested.make({ id: row.id })),
      ]);
    },
    BookmarksDismissed: () => (model.open ? next(closed(model), [toNormal()]) : next(model)),
    BookmarksBlurred: ({ chromeFocused }) => {
      if (!model.open) return next(model);

      return next(closed(model), chromeFocused ? [toNormal()] : []);
    },
  });
}
