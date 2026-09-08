import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { Bookmarks } from "./bookmarks";
import type { Database } from "./db/database";
import { closeTestDatabase, openTestDatabase } from "./db/test-database";
import { History } from "./history";
import { omniboxSuggestions } from "./omnibox";

let dir: string;
let db: Database;
let history: History;
let bookmarks: Bookmarks;

beforeEach(() => {
  ({ dir, db } = openTestDatabase("omnibox"));
  history = new History(db);
  bookmarks = new Bookmarks(db);
});

afterEach(() => {
  closeTestDatabase({ dir, db });
});

test("an empty query returns no suggestions", () => {
  history.record({ url: "https://example.com/", title: "Example", visitedAt: 1 });
  expect(omniboxSuggestions({ history, bookmarks }, "")).toEqual([]);
  expect(omniboxSuggestions({ history, bookmarks }, "   ")).toEqual([]);
});

test("a non-string query returns no suggestions", () => {
  history.record({ url: "https://example.com/", title: "Example", visitedAt: 1 });
  expect(omniboxSuggestions({ history, bookmarks }, 7)).toEqual([]);
  expect(omniboxSuggestions({ history, bookmarks }, null)).toEqual([]);
  expect(omniboxSuggestions({ history, bookmarks }, undefined)).toEqual([]);
});

test("matches from both sources are merged, bookmarks first", () => {
  bookmarks.add({ url: "https://example.com/saved", title: "Saved Example", createdAt: 1 });
  history.record({ url: "https://example.com/visited", title: "Visited Example", visitedAt: 1 });

  const suggestions = omniboxSuggestions({ history, bookmarks }, "example");

  expect(suggestions).toEqual([
    { label: "Saved Example", value: "https://example.com/saved", kind: "bookmark" },
    { label: "Visited Example", value: "https://example.com/visited", kind: "history" },
  ]);
});

test("a URL that is both bookmarked and visited shows once, as a bookmark", () => {
  bookmarks.add({ url: "https://example.com/", title: "Example", createdAt: 1 });
  history.record({ url: "https://example.com/", title: "Example", visitedAt: 1 });

  const suggestions = omniboxSuggestions({ history, bookmarks }, "example");

  expect(suggestions).toEqual([
    { label: "Example", value: "https://example.com/", kind: "bookmark" },
  ]);
});

test("a URL visited more than once shows only its newest history row", () => {
  history.record({ url: "https://example.com/", title: "First visit", visitedAt: 1 });
  history.record({ url: "https://example.com/", title: "Second visit", visitedAt: 2 });
  history.record({ url: "https://example.com/", title: "Third visit", visitedAt: 3 });

  const suggestions = omniboxSuggestions({ history, bookmarks }, "example");

  expect(suggestions).toEqual([
    { label: "Third visit", value: "https://example.com/", kind: "history" },
  ]);
});

test("a URL bookmarked more than once shows only its newest bookmark", () => {
  bookmarks.add({ url: "https://example.com/", title: "First save", createdAt: 1 });
  bookmarks.add({ url: "https://example.com/", title: "Second save", createdAt: 2 });

  const suggestions = omniboxSuggestions({ history, bookmarks }, "example");

  expect(suggestions).toEqual([
    { label: "Second save", value: "https://example.com/", kind: "bookmark" },
  ]);
});

test("each source is capped independently at 8 rows", () => {
  for (let i = 0; i < 10; i++) {
    bookmarks.add({ url: `https://example.com/b${i}`, title: `B ${i}`, createdAt: i });
    history.record({ url: `https://example.com/h${i}`, title: `H ${i}`, visitedAt: i });
  }

  const suggestions = omniboxSuggestions({ history, bookmarks }, "example");

  expect(suggestions.filter((s) => s.kind === "bookmark")).toHaveLength(8);
  expect(suggestions.filter((s) => s.kind === "history")).toHaveLength(8);
});

test("a query that matches nothing returns no suggestions", () => {
  bookmarks.add({ url: "https://example.com/", title: "Example", createdAt: 1 });
  history.record({ url: "https://example.com/", title: "Example", visitedAt: 1 });
  expect(omniboxSuggestions({ history, bookmarks }, "nothing-matches-this")).toEqual([]);
});
