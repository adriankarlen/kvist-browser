import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { testDatabase } from "./db/database";
import { omniboxSuggestions } from "./omnibox";
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

const suggest = (query: unknown) => runtime.runSync(omniboxSuggestions(query));

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

test("a non-string query returns no suggestions", () => {
  history.record({ url: "https://example.com/", title: "Example", visitedAt: 1 });
  expect(suggest(7)).toEqual([]);
  expect(suggest(null)).toEqual([]);
  expect(suggest(undefined)).toEqual([]);
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
