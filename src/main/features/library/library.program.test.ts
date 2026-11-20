import { expect, test } from "vite-plus/test";
import { Msg as MessagesMsg } from "../messages/messages.program";
import { Cmd, init, Msg, update } from "./library.program";

const M = Msg.cases;
const C = Cmd.cases;

const loaded = update(
  M.LibraryLoaded.make({ bookmarked: ["https://saved/"], zoom: [["https://a", 1]] }),
  init,
).model;

test("toggling an unsaved page adds it under its title, or its URL when it has none", () => {
  expect(
    update(M.BookmarkToggled.make({ url: "https://new/", title: "New" }), loaded).cmds,
  ).toEqual([C.AddBookmark.make({ url: "https://new/", title: "New" })]);
  expect(update(M.BookmarkToggled.make({ url: "https://new/", title: "  " }), loaded).cmds).toEqual(
    [C.AddBookmark.make({ url: "https://new/", title: "https://new/" })],
  );
});

test("toggling a saved page removes every bookmark for it, and says so", () => {
  const result = update(M.BookmarkToggled.make({ url: "https://saved/", title: "Saved" }), loaded);

  expect(result.cmds).toEqual([C.RemoveBookmarks.make({ url: "https://saved/" })]);
  expect(result.msgs).toEqual([
    MessagesMsg.cases.MessageShown.make({
      message: { text: "removed bookmark https://saved/", level: "info" },
    }),
  ]);
});

test("a zoom change is clamped, kept for the next navigation, and saved", () => {
  const result = update(M.ZoomChanged.make({ origin: "https://a", level: 99 }), loaded);

  expect(result.model.zoom.get("https://a")).toBe(5.7);
  expect(result.cmds).toEqual([C.SaveZoom.make({ origin: "https://a", level: 5.7 })]);
});

test("a committed visit is recorded", () => {
  expect(update(M.VisitCommitted.make({ url: "https://a/", at: 5 }), loaded).cmds).toEqual([
    C.RecordVisit.make({ url: "https://a/", at: 5 }),
  ]);
});
