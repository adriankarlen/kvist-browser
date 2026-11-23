import { describe, expect, test } from "vite-plus/test";
import { ChromeIntent } from "../../../shared/rpc/chrome";
import type { Bookmark } from "../../../shared/schema/bookmarks";
import { send } from "../link/link.program";
import { Cmd, init, type Model, Msg, update } from "./bookmarks.program";

const M = Msg.cases;
const I = ChromeIntent.cases;

const row = (id: number): Bookmark => ({
  id,
  url: `https://site${id}.test/`,
  title: `Site ${id}`,
  createdAt: id,
});

const rows = [row(3), row(2), row(1)];
const toNormal = send(I.ModeRequested.make({ mode: "normal" }));

/** Open, with the blank filter's rows in. */
const listed: Model = update(
  M.BookmarksFetched.make({ query: "", rows }),
  update(M.BookmarksOpenRequested.make({}), init).model,
).model;

describe("opening", () => {
  test("opens with an empty filter, asks for every row, and counts the opening", () => {
    const result = update(M.BookmarksOpenRequested.make({}), init);

    expect(result.model).toMatchObject({ open: true, query: "", selected: 0, opened: 1 });
    expect(result.cmds).toEqual([Cmd.cases.FetchBookmarks.make({ query: "" })]);
  });

  test("opening again while open resets the filter and counts again", () => {
    const typed = update(M.BookmarksQueryChanged.make({ query: "site" }), listed).model;
    const result = update(M.BookmarksOpenRequested.make({}), typed);

    expect(result.model).toMatchObject({ open: true, query: "", opened: 2 });
  });
});

describe("rows", () => {
  test("typing narrows: the selection goes back to the top and the query is fetched", () => {
    const moved = update(M.BookmarkSelectionMoved.make({ by: 1 }), listed).model;
    const result = update(M.BookmarksQueryChanged.make({ query: "site 2" }), moved);

    expect(result.model).toMatchObject({ query: "site 2", selected: 0 });
    expect(result.cmds).toEqual([Cmd.cases.FetchBookmarks.make({ query: "site 2" })]);
  });

  test("rows for a query the filter has moved past are dropped", () => {
    const typed = update(M.BookmarksQueryChanged.make({ query: "new" }), listed).model;

    expect(update(M.BookmarksFetched.make({ query: "", rows: [] }), typed).model.rows).toEqual(
      rows,
    );
  });

  test("rows that arrive after closing are dropped", () => {
    const shut = update(M.BookmarksDismissed.make({}), listed).model;

    expect(update(M.BookmarksFetched.make({ query: "", rows }), shut).model.rows).toEqual([]);
  });

  test("fewer rows pull the selection back inside the list", () => {
    const last = update(M.BookmarkSelectionMoved.make({ by: -1 }), listed).model;

    expect(last.selected).toBe(2);
    expect(
      update(M.BookmarksFetched.make({ query: "", rows: [row(3)] }), last).model.selected,
    ).toBe(0);
  });

  test("a change elsewhere refetches the current filter, but only while open", () => {
    const typed = update(M.BookmarksQueryChanged.make({ query: "site" }), listed).model;

    expect(update(M.BookmarksChanged.make({}), typed).cmds).toEqual([
      Cmd.cases.FetchBookmarks.make({ query: "site" }),
    ]);
    expect(update(M.BookmarksChanged.make({}), init).cmds).toEqual([]);
  });

  test("the selection wraps at both ends, and stays put with no rows", () => {
    expect(update(M.BookmarkSelectionMoved.make({ by: -1 }), listed).model.selected).toBe(2);
    expect(update(M.BookmarkSelectionMoved.make({ by: 3 }), listed).model.selected).toBe(0);

    const empty = { ...listed, rows: [] };

    expect(update(M.BookmarkSelectionMoved.make({ by: 1 }), empty).model.selected).toBe(0);
  });
});

describe("picking", () => {
  test("Enter opens the selected row in the active tab, closes, and hands keys back", () => {
    const moved = update(M.BookmarkSelectionMoved.make({ by: 1 }), listed).model;
    const result = update(M.BookmarkPicked.make({ id: undefined }), moved);

    expect(result.model).toMatchObject({ open: false, query: "", rows: [] });
    expect(result.cmds).toEqual([
      send(I.NavigationRequested.make({ url: "https://site2.test/" })),
      toNormal,
    ]);
  });

  test("a click opens the row it names", () => {
    expect(update(M.BookmarkPicked.make({ id: 1 }), listed).cmds[0]).toEqual(
      send(I.NavigationRequested.make({ url: "https://site1.test/" })),
    );
  });

  test("Enter on rows for an older query waits, then picks from the answer", () => {
    const typed = update(M.BookmarksQueryChanged.make({ query: "site 1" }), listed).model;
    const waiting = update(M.BookmarkPicked.make({ id: undefined }), typed);

    expect(waiting.model).toMatchObject({ open: true, pickPending: true });
    expect(waiting.cmds).toEqual([]);

    const answered = update(
      M.BookmarksFetched.make({ query: "site 1", rows: [row(1)] }),
      waiting.model,
    );

    expect(answered.model.open).toBe(false);
    expect(answered.cmds).toEqual([
      send(I.NavigationRequested.make({ url: "https://site1.test/" })),
      toNormal,
    ]);
  });

  test("Enter before the first answer since opening waits too", () => {
    const opened = update(M.BookmarksOpenRequested.make({}), init).model;

    expect(update(M.BookmarkPicked.make({ id: undefined }), opened).model.pickPending).toBe(true);
  });

  test("a waiting Enter whose answer is empty picks nothing and stops waiting", () => {
    const typed = update(M.BookmarksQueryChanged.make({ query: "zzz" }), listed).model;
    const waiting = update(M.BookmarkPicked.make({ id: undefined }), typed).model;
    const answered = update(M.BookmarksFetched.make({ query: "zzz", rows: [] }), waiting);

    expect(answered.model).toMatchObject({ open: true, pickPending: false });
    expect(answered.cmds).toEqual([]);
  });

  test("with nothing to pick, nothing happens", () => {
    const empty = { ...listed, rows: [] };

    expect(update(M.BookmarkPicked.make({ id: undefined }), empty).model).toBe(empty);
    expect(update(M.BookmarkPicked.make({ id: 99 }), listed).cmds).toEqual([]);
  });
});

describe("deleting", () => {
  test("drops the row at once and asks main to remove it", () => {
    const result = update(M.BookmarkDeleteRequested.make({ id: 2 }), listed);

    expect(result.model.rows.map(({ id }) => id)).toEqual([3, 1]);
    expect(result.cmds).toEqual([send(I.BookmarkRemoveRequested.make({ id: 2 }))]);
  });

  test("Shift+Delete removes the selected row, and the selection stays in the list", () => {
    const last = update(M.BookmarkSelectionMoved.make({ by: -1 }), listed).model;
    const result = update(M.BookmarkDeleteRequested.make({ id: undefined }), last);

    expect(result.cmds).toEqual([send(I.BookmarkRemoveRequested.make({ id: 1 }))]);
    expect(result.model.selected).toBe(1);
  });
});

test("Shift+Delete on rows for an older query deletes nothing", () => {
  const typed = update(M.BookmarksQueryChanged.make({ query: "site 1" }), listed);

  expect(update(M.BookmarkDeleteRequested.make({ id: undefined }), typed.model).cmds).toEqual([]);
});

describe("closing", () => {
  test("Escape closes and hands keys back to the page", () => {
    const result = update(M.BookmarksDismissed.make({}), listed);

    expect(result.model.open).toBe(false);
    expect(result.cmds).toEqual([toNormal]);
  });

  test("a blur closes, but hands keys to the page only when asked to", () => {
    expect(update(M.BookmarksBlurred.make({ handBack: true }), listed).cmds).toEqual([toNormal]);

    const away = update(M.BookmarksBlurred.make({ handBack: false }), listed);

    expect(away.model.open).toBe(false);
    expect(away.cmds).toEqual([]);
  });

  test("the blur that follows a pick or a dismissal does nothing", () => {
    const shut = update(M.BookmarkPicked.make({ id: undefined }), listed).model;
    const result = update(M.BookmarksBlurred.make({ handBack: true }), shut);

    expect(result.model).toBe(shut);
    expect(result.cmds).toEqual([]);
  });
});
