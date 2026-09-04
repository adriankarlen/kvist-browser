import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { Bookmarks } from "./bookmarks";
import { Database } from "./db/database";

const REAL_MIGRATIONS = join(process.cwd(), "src/main/db/migrations");

let dir: string;
let migDir: string;
let db: Database;
let bookmarks: Bookmarks;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kvist-bookmarks-"));
  migDir = join(dir, "migrations");
  mkdirSync(migDir, { recursive: true });

  // Copy the real migrations into the test folder so `Database.open` runs
  // them and the `bookmarks` table exists before the test starts.
  for (const entry of readdirSync(REAL_MIGRATIONS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    cpSync(join(REAL_MIGRATIONS, entry.name), join(migDir, entry.name), {
      recursive: true,
    });
  }

  db = Database.open(join(dir, "bookmarks.db"), migDir);
  bookmarks = new Bookmarks(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const add = (url: string, title = url, createdAt = 1): boolean =>
  bookmarks.add({ url, title, createdAt });

test("add writes a row and the URL comes back from list", () => {
  expect(add("https://example.com/", "Example", 1000)).toBe(true);
  const rows = bookmarks.list();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.url).toBe("https://example.com/");
  expect(rows[0]?.title).toBe("Example");
  expect(rows[0]?.createdAt).toBe(1000);
});

test("add drops inputs that fail validation", () => {
  expect(add("not a url")).toBe(false);
  expect(add("")).toBe(false);
  expect(add("https://example.com/", "", 1)).toBe(false);
  expect(add("https://example.com/", "ok", -1)).toBe(false);
  expect(bookmarks.list()).toEqual([]);
});

test("add rejects an explicit null createdAt rather than defaulting it", () => {
  // Only a missing createdAt (undefined) should fall back to Date.now().
  // An explicit null is a malformed call the validator must catch, not a
  // second spelling of "not provided".
  // SAFETY: the cast widens null past AddInput's `number | undefined` so the
  // validator has a chance to reject it — without it, TS would reject the
  // object literal at compile time and the assertion under test would not
  // exist.
  const bad = {
    url: "https://example.com/",
    title: "Example",
    createdAt: null as unknown as number,
  };
  expect(bookmarks.add(bad)).toBe(false);
  expect(bookmarks.list()).toEqual([]);
});

test("add is not deduplicating: two adds for the same URL produce two rows", () => {
  expect(add("https://example.com/", "First", 1)).toBe(true);
  expect(add("https://example.com/", "Second", 2)).toBe(true);
  const rows = bookmarks.list();
  expect(rows).toHaveLength(2);
  expect(rows[0]?.title).toBe("Second");
  expect(rows[1]?.title).toBe("First");
});

test("add defaults createdAt to the current time when not provided", () => {
  const before = Date.now();
  expect(bookmarks.add({ url: "https://example.com/", title: "Example" })).toBe(true);
  const after = Date.now();
  const row = bookmarks.list()[0]!;
  // The default calls Date.now() between `before` and `after`; a value
  // outside that window would mean `add` is reading the clock somewhere
  // else.
  expect(row.createdAt).toBeGreaterThanOrEqual(before);
  expect(row.createdAt).toBeLessThanOrEqual(after);
});

test("add with an explicit createdAt stores that value", () => {
  expect(add("https://example.com/", "Example", 12345)).toBe(true);
  expect(bookmarks.list()[0]?.createdAt).toBe(12345);
});

test("list orders newest first", () => {
  add("https://a.example/", "A", 1);
  add("https://b.example/", "B", 2);
  add("https://c.example/", "C", 3);
  expect(bookmarks.list().map((row) => row.createdAt)).toEqual([3, 2, 1]);
});

test("list respects the limit", () => {
  for (let i = 0; i < 10; i++) add(`https://x.example/${i}`, `X ${i}`, i);
  expect(bookmarks.list({ limit: 3 })).toHaveLength(3);
});

test("list returns all rows when the limit is above the hard cap", () => {
  for (let i = 0; i < 5; i++) add(`https://y.example/${i}`, `Y ${i}`, i);
  // The cap is 500; five rows is well under it, so this returns all of them.
  expect(bookmarks.list({ limit: 1000 })).toHaveLength(5);
});

test("get returns the matching row", () => {
  add("https://a.example/", "A", 1);
  add("https://b.example/", "B", 2);
  const row = bookmarks.get(2);
  expect(row?.url).toBe("https://b.example/");
  expect(row?.title).toBe("B");
});

test("get returns null when no row matches", () => {
  expect(bookmarks.get(1)).toBeNull();
  add("https://a.example/", "A", 1);
  expect(bookmarks.get(999)).toBeNull();
});

test("get returns null for malformed ids", () => {
  // A bad id is a stale UI snapshot, not a throw — the chrome should not
  // crash because a row disappeared in the same tick.
  expect(bookmarks.get(0)).toBeNull();
  expect(bookmarks.get(-1)).toBeNull();
  expect(bookmarks.get(1.5)).toBeNull();
});

test("has returns true after add and false before any add", () => {
  expect(bookmarks.has("https://example.com/")).toBe(false);
  expect(add("https://example.com/", "Example", 1)).toBe(true);
  expect(bookmarks.has("https://example.com/")).toBe(true);
});

test("has returns true for any of a URL's bookmarks, not only the newest", () => {
  // Two rows for the same URL are intentional; the existence check answers
  // "is this URL bookmarked?" and is not the place to ask about duplicates.
  add("https://example.com/", "First", 1);
  add("https://example.com/", "Second", 2);
  expect(bookmarks.has("https://example.com/")).toBe(true);
});

test("has returns false for an invalid URL", () => {
  expect(bookmarks.has("not a url")).toBe(false);
  expect(bookmarks.has("")).toBe(false);
});

test("remove drops the row and returns true", () => {
  add("https://a.example/", "A", 1);
  const id = bookmarks.list()[0]!.id;
  expect(bookmarks.remove(id)).toBe(true);
  expect(bookmarks.list()).toEqual([]);
});

test("remove returns false for an unknown id", () => {
  expect(bookmarks.remove(999)).toBe(false);
  add("https://a.example/", "A", 1);
  expect(bookmarks.remove(999)).toBe(false);
  expect(bookmarks.list()).toHaveLength(1);
});

test("remove returns false for malformed ids", () => {
  add("https://a.example/", "A", 1);
  expect(bookmarks.remove(0)).toBe(false);
  expect(bookmarks.remove(-1)).toBe(false);
  expect(bookmarks.remove(1.5)).toBe(false);
  expect(bookmarks.list()).toHaveLength(1);
});

test("has flips to false after remove", () => {
  add("https://example.com/", "Example", 1);
  const id = bookmarks.list()[0]!.id;
  expect(bookmarks.has("https://example.com/")).toBe(true);
  expect(bookmarks.remove(id)).toBe(true);
  expect(bookmarks.has("https://example.com/")).toBe(false);
});

test("remove only drops its own row", () => {
  add("https://a.example/", "A", 1);
  add("https://b.example/", "B", 2);
  const first = bookmarks.list().find((row) => row.url === "https://a.example/")!;
  expect(bookmarks.remove(first.id)).toBe(true);
  expect(bookmarks.list().map((row) => row.url)).toEqual(["https://b.example/"]);
});

test("search matches URL substrings", () => {
  add("https://example.com/", "Example", 1);
  add("https://other.com/", "Other", 2);
  add("https://example.com/page", "Example Page", 3);

  const hits = bookmarks.search("example");
  expect(hits.map((row) => row.url)).toEqual(["https://example.com/page", "https://example.com/"]);
});

test("search matches title substrings", () => {
  add("https://a.test/", "About Example", 1);
  add("https://b.test/", "Unrelated", 2);
  // Neither URL contains "example", so a hit here can only come from the
  // title predicate — unlike the previous fixture, this isolates it from
  // the URL match instead of riding along with it.
  expect(bookmarks.search("example").map((row) => row.title)).toEqual(["About Example"]);
});

test("search returns rows newest first", () => {
  add("https://a.example/", "A", 1);
  add("https://b.example/", "B", 2);
  add("https://c.example/", "C", 3);
  expect(bookmarks.search("example").map((row) => row.createdAt)).toEqual([3, 2, 1]);
});

test("search respects the limit", () => {
  for (let i = 0; i < 10; i++) add(`https://x.example/${i}`, `X ${i}`, i);
  expect(bookmarks.search("example", { limit: 3 })).toHaveLength(3);
});

test("search returns all rows when the limit is above the hard cap", () => {
  for (let i = 0; i < 5; i++) add(`https://y.example/${i}`, `Y ${i}`, i);
  expect(bookmarks.search("example", { limit: 1000 })).toHaveLength(5);
});

test("search returns no rows for an empty pattern", () => {
  add("https://example.com/", "Example", 1);
  expect(bookmarks.search("")).toEqual([]);
});

test("search treats '%' as a literal, not a wildcard", () => {
  // A user typing `%` into a search box should not turn the query into
  // "match anything" — this is the regression the LIKE-escape fix
  // exists to prevent.
  add("https://example.com/100%", "Sale", 1);
  add("https://other.com/", "Other", 2);
  expect(bookmarks.search("%").map((row) => row.url)).toEqual(["https://example.com/100%"]);
});

test("search treats '_' as a literal, not a single-char wildcard", () => {
  add("https://example.com/a_b", "X", 1);
  add("https://example.com/axb", "Y", 2);
  // '_' matches one character in raw LIKE, so without escaping this
  // would return both rows.
  expect(bookmarks.search("_").map((row) => row.url)).toEqual(["https://example.com/a_b"]);
});

test("search treats '\\' as a literal escape character in the query", () => {
  add("https://example.com/path\\file", "X", 1);
  add("https://example.com/pathXfile", "Y", 2);
  // Without escape handling, the backslash collides with our ESCAPE
  // clause and the second row would also match.
  expect(bookmarks.search("\\").map((row) => row.url)).toEqual(["https://example.com/path\\file"]);
});
