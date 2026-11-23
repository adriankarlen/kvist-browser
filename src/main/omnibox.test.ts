import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { testDatabase } from "./db/database";
import type { BrowserState, TabState } from "../shared/schema/browser";
import { omniboxSuggestions, tabSuggestions } from "./omnibox";
import { BookmarksRepo } from "./services/bookmarks-repo";
import { HistoryRepo } from "./services/history-repo";

const layer = Layer.mergeAll(HistoryRepo.layer, BookmarksRepo.layer).pipe(
  Layer.provideMerge(testDatabase),
);

let runtime: ManagedRuntime.ManagedRuntime<Layer.Success<typeof layer>, unknown>;

beforeEach(() => {
  runtime = ManagedRuntime.make(layer);
});

afterEach(() => Effect.runSync(runtime.disposeEffect));

const NO_TABS: BrowserState = { tabs: [], activeId: null };

const suggest = (query: string, browser: BrowserState = NO_TABS) =>
  runtime.runSync(omniboxSuggestions(query, browser));

const history = {
  record: (input: { url: string; title: string; visitedAt: number }) =>
    runtime.runSync(Effect.flatMap(Effect.service(HistoryRepo), (repo) => repo.record(input))),
};

const bookmarks = {
  add: (input: { url: string; title: string; createdAt?: number }) =>
    runtime.runSync(Effect.flatMap(Effect.service(BookmarksRepo), (repo) => repo.add(input))),
};

test("an empty query returns no suggestions", () => {
  history.record({ url: "https://example.com/", title: "Example", visitedAt: 1 });
  expect(suggest("")).toEqual([]);
  expect(suggest("   ")).toEqual([]);
});

test("matches from both sources are merged, bookmarks first", () => {
  bookmarks.add({ url: "https://example.com/saved", title: "Saved Example", createdAt: 1 });
  history.record({ url: "https://example.com/visited", title: "Visited Example", visitedAt: 1 });

  const suggestions = suggest("example");

  expect(suggestions).toEqual([
    { label: "Saved Example", value: "https://example.com/saved", kind: "bookmark" },
    { label: "Visited Example", value: "https://example.com/visited", kind: "history" },
  ]);
});

test("a URL that is both bookmarked and visited shows once, as a bookmark", () => {
  bookmarks.add({ url: "https://example.com/", title: "Example", createdAt: 1 });
  history.record({ url: "https://example.com/", title: "Example", visitedAt: 1 });

  const suggestions = suggest("example");

  expect(suggestions).toEqual([
    { label: "Example", value: "https://example.com/", kind: "bookmark" },
  ]);
});

test("a URL visited more than once shows only its newest history row", () => {
  history.record({ url: "https://example.com/", title: "First visit", visitedAt: 1 });
  history.record({ url: "https://example.com/", title: "Second visit", visitedAt: 2 });
  history.record({ url: "https://example.com/", title: "Third visit", visitedAt: 3 });

  const suggestions = suggest("example");

  expect(suggestions).toEqual([
    { label: "Third visit", value: "https://example.com/", kind: "history" },
  ]);
});

test("a URL bookmarked more than once shows only its newest bookmark", () => {
  bookmarks.add({ url: "https://example.com/", title: "First save", createdAt: 1 });
  bookmarks.add({ url: "https://example.com/", title: "Second save", createdAt: 2 });

  const suggestions = suggest("example");

  expect(suggestions).toEqual([
    { label: "Second save", value: "https://example.com/", kind: "bookmark" },
  ]);
});

test("each source is capped independently at 8 rows", () => {
  for (let i = 0; i < 10; i++) {
    bookmarks.add({ url: `https://example.com/b${i}`, title: `B ${i}`, createdAt: i });
    history.record({ url: `https://example.com/h${i}`, title: `H ${i}`, visitedAt: i });
  }

  const suggestions = suggest("example");

  expect(suggestions.filter((s) => s.kind === "bookmark")).toHaveLength(8);
  expect(suggestions.filter((s) => s.kind === "history")).toHaveLength(8);
});

test("a query that matches nothing returns no suggestions", () => {
  bookmarks.add({ url: "https://example.com/", title: "Example", createdAt: 1 });
  history.record({ url: "https://example.com/", title: "Example", visitedAt: 1 });
  expect(suggest("nothing-matches-this")).toEqual([]);
});

const tab = (id: number, url: string, title: string): TabState => ({
  id,
  title,
  url,
  favicon: null,
  loading: false,
  canGoBack: false,
  canGoForward: false,
  zoomLevel: 0,
  bookmarked: false,
});

const browserOf = (activeId: number, ...tabs: TabState[]): BrowserState => ({ tabs, activeId });

test("open tabs match on title or URL, case-insensitively, and skip the active tab", () => {
  const browser = browserOf(
    1,
    tab(1, "https://example.com/active", "Example active"),
    tab(2, "https://docs.example.com/", "Docs"),
    tab(3, "https://other.test/", "An EXAMPLE page"),
    tab(4, "https://unrelated.test/", "Unrelated"),
  );

  expect(tabSuggestions(browser, "example")).toEqual([
    { label: "Docs", value: "https://docs.example.com/", kind: "tab", tabId: 2 },
    { label: "An EXAMPLE page", value: "https://other.test/", kind: "tab", tabId: 3 },
  ]);
});

test("an untitled tab is labelled with its URL", () => {
  const browser = browserOf(1, tab(1, "about:blank", ""), tab(2, "https://example.com/", ""));

  expect(tabSuggestions(browser, "example")).toEqual([
    { label: "https://example.com/", value: "https://example.com/", kind: "tab", tabId: 2 },
  ]);
});

test("an open tab comes first and hides bookmark and history rows for its URL", () => {
  bookmarks.add({ url: "https://example.com/open", title: "Open bookmark", createdAt: 1 });
  history.record({ url: "https://example.com/open", title: "Open visit", visitedAt: 1 });
  history.record({ url: "https://example.com/closed", title: "Closed visit", visitedAt: 2 });

  const browser = browserOf(
    1,
    tab(1, "https://elsewhere.test/", "Elsewhere"),
    tab(2, "https://example.com/open", "Open tab"),
  );

  expect(suggest("example", browser)).toEqual([
    { label: "Open tab", value: "https://example.com/open", kind: "tab", tabId: 2 },
    { label: "Closed visit", value: "https://example.com/closed", kind: "history" },
  ]);
});
