import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { bookmarkRows } from "./bookmark-rows";
import { testDatabase } from "./db/database";
import { MAX_LIMIT } from "./db/query";
import { BookmarksRepo } from "./services/bookmarks-repo";

const layer = BookmarksRepo.layer.pipe(Layer.provideMerge(testDatabase));

let runtime: ManagedRuntime.ManagedRuntime<Layer.Success<typeof layer>, unknown>;

beforeEach(() => {
  runtime = ManagedRuntime.make(layer);
});

afterEach(() => Effect.runSync(runtime.disposeEffect));

const rows = (query: string) => runtime.runSync(bookmarkRows(query));

const add = (url: string, title: string, createdAt: number) =>
  runtime.runSync(
    Effect.flatMap(Effect.service(BookmarksRepo), (repo) => repo.add({ url, title, createdAt })),
  );

test("a blank query lists every bookmark, newest first", () => {
  add("https://a.test/", "A", 1);
  add("https://b.test/", "B", 2);

  expect(rows("").map((row) => row.title)).toEqual(["B", "A"]);
  expect(rows("   ").map((row) => row.title)).toEqual(["B", "A"]);
});

test("a query narrows by title or URL", () => {
  add("https://a.test/", "Apples", 1);
  add("https://b.test/pears", "Fruit", 2);
  add("https://c.test/", "Cars", 3);

  expect(rows("apple").map((row) => row.url)).toEqual(["https://a.test/"]);
  expect(rows(" pears ").map((row) => row.url)).toEqual(["https://b.test/pears"]);
});

test("rows carry what the panel shows", () => {
  add("https://a.test/", "A", 42);

  expect(rows("")).toEqual([
    { id: expect.any(Number), url: "https://a.test/", title: "A", createdAt: 42 },
  ]);
});

test("the list is not cut at the default page size", () => {
  for (let i = 0; i < 60; i++) add(`https://a.test/${i}`, `A ${i}`, i);

  expect(rows("")).toHaveLength(60);
  expect(MAX_LIMIT).toBeGreaterThan(60);
});
