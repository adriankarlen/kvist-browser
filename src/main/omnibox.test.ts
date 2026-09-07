import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { Bookmarks } from "./bookmarks";
import { Database } from "./db/database";
import { History } from "./history";
import { omniboxSuggestions } from "./omnibox";

const REAL_MIGRATIONS = join(process.cwd(), "src/main/db/migrations");

let dir: string;
let migDir: string;
let db: Database;
let history: History;
let bookmarks: Bookmarks;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kvist-omnibox-"));
  migDir = join(dir, "migrations");
  mkdirSync(migDir, { recursive: true });

  for (const entry of readdirSync(REAL_MIGRATIONS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    cpSync(join(REAL_MIGRATIONS, entry.name), join(migDir, entry.name), {
      recursive: true,
    });
  }

  db = Database.open(join(dir, "omnibox.db"), migDir);
  history = new History(db);
  bookmarks = new Bookmarks(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("an empty query returns no suggestions", () => {
  history.record({ url: "https://example.com/", title: "Example", visitedAt: 1 });
  expect(omniboxSuggestions(history, bookmarks, "")).toEqual([]);
  expect(omniboxSuggestions(history, bookmarks, "   ")).toEqual([]);
});

test("matches from both sources are merged, bookmarks first", () => {
  bookmarks.add({ url: "https://example.com/saved", title: "Saved Example", createdAt: 1 });
  history.record({ url: "https://example.com/visited", title: "Visited Example", visitedAt: 1 });

  const suggestions = omniboxSuggestions(history, bookmarks, "example");

  expect(suggestions).toEqual([
    { label: "Saved Example", value: "https://example.com/saved", kind: "bookmark" },
    { label: "Visited Example", value: "https://example.com/visited", kind: "history" },
  ]);
});

test("a URL that is both bookmarked and visited shows once, as a bookmark", () => {
  bookmarks.add({ url: "https://example.com/", title: "Example", createdAt: 1 });
  history.record({ url: "https://example.com/", title: "Example", visitedAt: 1 });

  const suggestions = omniboxSuggestions(history, bookmarks, "example");

  expect(suggestions).toEqual([
    { label: "Example", value: "https://example.com/", kind: "bookmark" },
  ]);
});

test("each source is capped independently at 8 rows", () => {
  for (let i = 0; i < 10; i++) {
    bookmarks.add({ url: `https://example.com/b${i}`, title: `B ${i}`, createdAt: i });
    history.record({ url: `https://example.com/h${i}`, title: `H ${i}`, visitedAt: i });
  }

  const suggestions = omniboxSuggestions(history, bookmarks, "example");

  expect(suggestions.filter((s) => s.kind === "bookmark")).toHaveLength(8);
  expect(suggestions.filter((s) => s.kind === "history")).toHaveLength(8);
});

test("a query that matches nothing returns no suggestions", () => {
  bookmarks.add({ url: "https://example.com/", title: "Example", createdAt: 1 });
  history.record({ url: "https://example.com/", title: "Example", visitedAt: 1 });
  expect(omniboxSuggestions(history, bookmarks, "nothing-matches-this")).toEqual([]);
});
