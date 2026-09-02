import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { Database } from "./db/database";
import { session as sessionTable } from "./db/schema";
import { Session, type SessionState } from "./session";

const REAL_MIGRATIONS = join(process.cwd(), "src/main/db/migrations");

let dir: string;
let migDir: string;
let db: Database;
let session: Session;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kvist-session-"));
  migDir = join(dir, "migrations");
  mkdirSync(migDir, { recursive: true });

  // Copy the real migrations into the test folder so `Database.open` runs
  // them and both `history` and `session` tables exist before the test
  // starts — `session` is the table this file is about, but the migrator
  // expects the full ordered set.
  for (const entry of readdirSync(REAL_MIGRATIONS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    cpSync(join(REAL_MIGRATIONS, entry.name), join(migDir, entry.name), {
      recursive: true,
    });
  }

  db = Database.open(join(dir, "session.db"), migDir);
  session = new Session(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const baseState: SessionState = {
  tabs: ["https://example.com/", "https://example.org/"],
  activeIndex: 1,
  width: 1280,
  height: 800,
  x: 100,
  y: 50,
  orientation: "vertical",
};

test("load returns null when no session has been saved", () => {
  expect(session.load()).toBeNull();
});

test("save then load round-trips the full state", () => {
  expect(session.save(baseState, 1700000000000)).toBe(true);
  expect(session.load()).toEqual(baseState);
});

test("save overwrites the previous row on a second call", () => {
  expect(session.save(baseState, 1)).toBe(true);
  const next: SessionState = { ...baseState, activeIndex: 0 };
  expect(session.save(next, 2)).toBe(true);

  const loaded = session.load();
  expect(loaded?.activeIndex).toBe(0);
});

test("save drops input with an empty tab list rather than throwing", () => {
  const empty: SessionState = { ...baseState, tabs: [] };
  // The closed-window path runs without a try/catch around it; an
  // exception there would tear down the window with nothing to restore.
  expect(session.save(empty, 1)).toBe(false);
  expect(session.load()).toBeNull();
});

test("save drops input with a negative activeIndex", () => {
  expect(session.save({ ...baseState, activeIndex: -1 }, 1)).toBe(false);
  expect(session.load()).toBeNull();
});

test("save drops input with zero window dimensions", () => {
  expect(session.save({ ...baseState, width: 0 }, 1)).toBe(false);
  expect(session.save({ ...baseState, height: 0 }, 1)).toBe(false);
  expect(session.load()).toBeNull();
});

test("save drops input with an empty string in the tab list", () => {
  // An empty URL would silently turn into about:blank on restore, which
  // the load side already rejects — the save side has to reject too,
  // otherwise the user gets a "no session" launch for a row they
  // thought they saved.
  const withEmpty = { ...baseState, tabs: ["https://ok.example", ""] };
  expect(session.save(withEmpty, 1)).toBe(false);
  expect(session.load()).toBeNull();
});

test("save drops input with activeIndex beyond tabs.length", () => {
  // Symmetric with load: a row whose activeIndex points past the tab list
  // would not survive load's range check, so the save side has to reject
  // it up front rather than plant a row that disappears on the next
  // launch.
  expect(session.save({ ...baseState, activeIndex: 5 }, 1)).toBe(false);
  expect(session.load()).toBeNull();
});

test("save drops input with an unknown orientation string", () => {
  // The renderer's setter only ever sends 'horizontal' | 'vertical' | null,
  // but the validator is the layer that protects against drift.
  // SAFETY: the cast widens "diagonal" past the TabOrientation union so the
  // validator has a chance to reject it — without it, TS would reject the
  // object literal at compile time and the assertion under test would not exist.
  const bad = { ...baseState, orientation: "diagonal" as unknown as "horizontal" };
  expect(session.save(bad, 1)).toBe(false);
  expect(session.load()).toBeNull();
});

test("load returns null when the row's activeIndex is out of range", () => {
  // Bypass save() to plant a row directly: this is the failure mode that
  // matters (a corrupted row from a previous version), not a present-day
  // input bug.
  expect(session.save(baseState, 1)).toBe(true);
  db.drizzle.update(sessionTable).set({ activeIndex: 99 }).run();
  expect(session.load()).toBeNull();
});

test("load returns null when the JSON column does not decode", () => {
  expect(session.save(baseState, 1)).toBe(true);
  db.drizzle.update(sessionTable).set({ tabsJson: "not json" }).run();
  expect(session.load()).toBeNull();
});

test("load returns null when the JSON column decodes to a non-array", () => {
  expect(session.save(baseState, 1)).toBe(true);
  db.drizzle.update(sessionTable).set({ tabsJson: '{"not":"an array"}' }).run();
  expect(session.load()).toBeNull();
});

test("load returns null when the URL list decodes to an empty array", () => {
  expect(session.save(baseState, 1)).toBe(true);
  db.drizzle.update(sessionTable).set({ tabsJson: "[]" }).run();
  expect(session.load()).toBeNull();
});

test("load returns null when the URL list contains an empty string", () => {
  expect(session.save(baseState, 1)).toBe(true);
  db.drizzle.update(sessionTable).set({ tabsJson: '["https://ok.example", ""]' }).run();
  expect(session.load()).toBeNull();
});

test("a state with null position and orientation survives the round-trip", () => {
  const headless: SessionState = {
    ...baseState,
    x: null,
    y: null,
    orientation: null,
  };
  expect(session.save(headless, 1)).toBe(true);
  expect(session.load()).toEqual(headless);
});

test("clear removes the row so the next load is null", () => {
  expect(session.save(baseState, 1)).toBe(true);
  expect(session.load()).not.toBeNull();
  session.clear();
  expect(session.load()).toBeNull();
});

test("clear is a no-op when there is no row", () => {
  // The close handler runs `clear()` regardless of whether `save` ever ran
  // (a window that opened and closed without any tabs) — the call must not
  // throw on an empty table.
  expect(() => session.clear()).not.toThrow();
  expect(session.load()).toBeNull();
});
