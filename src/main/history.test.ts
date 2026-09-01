import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { Database } from "./db/database";
import { formatErrorPageUrl } from "./error-page";
import { History } from "./history";

const REAL_MIGRATIONS = join(process.cwd(), "src/main/db/migrations");

let dir: string;
let migDir: string;
let db: Database;
let history: History;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kvist-history-"));
  migDir = join(dir, "migrations");
  mkdirSync(migDir, { recursive: true });

  // Copy the real migrations into the test folder so `Database.open` runs
  // them and the `history` table exists before the test starts.
  for (const entry of readdirSync(REAL_MIGRATIONS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    cpSync(join(REAL_MIGRATIONS, entry.name), join(migDir, entry.name), {
      recursive: true,
    });
  }

  db = Database.open(join(dir, "history.db"), migDir);
  history = new History(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const record = (url: string, title = url, visitedAt = 1): boolean =>
  history.record({ url, title, visitedAt });

test("record writes a row and the URL comes back from recent", () => {
  expect(record("https://example.com/", "Example", 1000)).toBe(true);
  const rows = history.recent();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.url).toBe("https://example.com/");
  expect(rows[0]?.title).toBe("Example");
  expect(rows[0]?.origin).toBe("https://example.com");
  expect(rows[0]?.visitedAt).toBe(1000);
});

test("record drops error-page wrappers and does not pollute the table", () => {
  const wrapper = formatErrorPageUrl({
    code: -105,
    description: "name not resolved",
    url: "https://gone.example/",
  });
  expect(record(wrapper)).toBe(false);
  expect(history.recent()).toEqual([]);
});

test("record drops URLs with an opaque origin", () => {
  expect(record("data:text/html,hi")).toBe(false);
  expect(record("about:blank")).toBe(false);
  expect(record("blob:https://example.com/abc")).toBe(false);
  expect(record("mailto:foo@bar.com")).toBe(false);
  expect(history.recent()).toEqual([]);
});

test("record drops inputs that fail validation", () => {
  expect(record("not a url")).toBe(false);
  expect(record("")).toBe(false);
  expect(record("https://example.com/", "", 1)).toBe(false);
  expect(record("https://example.com/", "ok", -1)).toBe(false);
  expect(history.recent()).toEqual([]);
});

test("record appends a row per call, treating reloads as their own visit", () => {
  record("https://example.com/", "First", 1);
  record("https://example.com/", "Second", 2);
  expect(history.recent()).toHaveLength(2);
});

test("search matches URL substrings", () => {
  record("https://example.com/", "Example", 1);
  record("https://other.com/", "Other", 2);
  record("https://example.com/page", "Example Page", 3);

  const hits = history.search("example");
  expect(hits.map((row) => row.url)).toEqual(["https://example.com/page", "https://example.com/"]);
});

test("search matches title substrings", () => {
  record("https://a.example/", "About Example", 1);
  record("https://b.example/", "Unrelated", 2);
  // Both URLs match the URL filter; the title-only match is the older one.
  expect(history.search("example").map((row) => row.title)).toEqual(["Unrelated", "About Example"]);
});

test("search returns rows newest first", () => {
  record("https://a.example/", "A", 1);
  record("https://b.example/", "B", 2);
  record("https://c.example/", "C", 3);
  expect(history.search("example").map((row) => row.visitedAt)).toEqual([3, 2, 1]);
});

test("search respects the limit", () => {
  for (let i = 0; i < 10; i++) record(`https://x.example/${i}`, `X ${i}`, i);
  expect(history.search("example", { limit: 3 })).toHaveLength(3);
});

test("search returns all rows when the limit is above the hard cap", () => {
  for (let i = 0; i < 5; i++) record(`https://y.example/${i}`, `Y ${i}`, i);
  // The cap is 500; five rows is well under it, so this returns all of them.
  expect(history.search("example", { limit: 1000 })).toHaveLength(5);
});

test("search returns no rows for an empty pattern", () => {
  record("https://example.com/", "Example", 1);
  expect(history.search("")).toEqual([]);
});

test("search treats '%' as a literal, not a wildcard", () => {
  // A user typing `%` into a search box should not turn the query into
  // "match anything" — this is the regression the LIKE-escape fix
  // exists to prevent.
  record("https://example.com/100%", "Sale", 1);
  record("https://other.com/", "Other", 2);
  expect(history.search("%").map((row) => row.url)).toEqual(["https://example.com/100%"]);
});

test("search treats '_' as a literal, not a single-char wildcard", () => {
  record("https://example.com/a_b", "X", 1);
  record("https://example.com/axb", "Y", 2);
  // '_' matches one character in raw LIKE, so without escaping this
  // would return both rows.
  expect(history.search("_").map((row) => row.url)).toEqual(["https://example.com/a_b"]);
});

test("search treats '\\' as a literal escape character in the query", () => {
  record("https://example.com/path\\file", "X", 1);
  record("https://example.com/pathXfile", "Y", 2);
  // Without escape handling, the backslash collides with our ESCAPE
  // clause and the second row would also match.
  expect(history.search("\\").map((row) => row.url)).toEqual(["https://example.com/path\\file"]);
});

test("recent respects the limit", () => {
  for (let i = 0; i < 10; i++) record(`https://z.example/${i}`, `Z ${i}`, i);
  expect(history.recent(3)).toHaveLength(3);
});

test("the origin column preserves port and scheme", () => {
  record("https://example.com:8443/path", "Example", 1);
  expect(history.recent()[0]?.origin).toBe("https://example.com:8443");
});

test("kvist:// and file:// origins are persistable", () => {
  record("kvist://newtab", "New Tab", 1);
  record("file:///home/user/x.html", "Local", 2);
  expect(history.recent()).toHaveLength(2);
});
