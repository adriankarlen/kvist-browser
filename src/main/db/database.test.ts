import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { Database, defaultMigrationsFolder } from "./database";

let dir: string;
let migDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kvist-db-"));
  migDir = join(dir, "migrations");
  mkdirSync(migDir, { recursive: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/** Writes a migration in the v7 folder layout that the runtime migrator reads. */
function writeMigration(name: string, sql: string): void {
  const folder = join(migDir, name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "migration.sql"), sql);
  writeFileSync(
    join(folder, "snapshot.json"),
    JSON.stringify({ version: "7", dialect: "sqlite", entries: [] }),
  );
}

const widgets = sqliteTable("widgets", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
});

test("defaultMigrationsFolder resolves to an existing directory", () => {
  // The default folder is what production uses when `Database.open` is
  // called with no second argument; an ENOENT there leaves the user
  // staring at a window that never opens. This is the assertion that
  // would have caught the `../../migrations/` regression.
  const folder = defaultMigrationsFolder();
  expect(() => mkdirSync(folder, { recursive: true })).not.toThrow();
});

test("Database.open with the default migrations folder does not throw", () => {
  // The source migrations folder is empty (KVI-24 is foundations only),
  // so the migrator is a no-op and the test passes when the default
  // path resolves correctly.
  const dbFile = join(dir, "default.db");
  const db = Database.open(dbFile);
  expect(db.drizzle).toBeDefined();
  db.close();
});

test("an empty migrations folder is a no-op, just creates the bookkeeping table", () => {
  const dbFile = join(dir, "test.db");
  const db = Database.open(dbFile, migDir);

  // `__drizzle_migrations` is the migrator's bookkeeping; the app
  // schema is empty for KVI-24 by design.
  const names = db.drizzle.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  expect(names.map((row) => row.name)).toEqual(["__drizzle_migrations"]);
  db.close();
});

test("a real migration creates the table and is idempotent across re-opens", () => {
  writeMigration(
    "20260101000000_init",
    "CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL);",
  );
  const dbFile = join(dir, "test.db");

  const first = Database.open(dbFile, migDir);
  first.drizzle.insert(widgets).values({ id: 1, name: "spinner" }).run();
  expect(first.drizzle.select().from(widgets).all()).toEqual([{ id: 1, name: "spinner" }]);
  first.close();

  // The bookkeeping table records the migration, so re-opening is a
  // no-op for the SQL but the data we wrote is still on disk.
  const second = Database.open(dbFile, migDir);
  expect(second.drizzle.select().from(widgets).all()).toEqual([{ id: 1, name: "spinner" }]);
  second.close();
});

test("WAL journal mode is on", () => {
  const db = Database.open(join(dir, "test.db"), migDir);
  const rows = db.drizzle.all<{ journal_mode: string }>("PRAGMA journal_mode");
  expect(rows[0]?.journal_mode).toBe("wal");
  db.close();
});

test("foreign keys enforcement is on", () => {
  const db = Database.open(join(dir, "test.db"), migDir);
  const rows = db.drizzle.all<{ foreign_keys: number }>("PRAGMA foreign_keys");
  expect(rows[0]?.foreign_keys).toBe(1);
  db.close();
});

test("the parent directory is created on first open", () => {
  const nested = join(dir, "a", "b", "c", "test.db");
  const db = Database.open(nested, migDir);
  expect(() => db.close()).not.toThrow();
});

test("close is idempotent", () => {
  const db = Database.open(join(dir, "test.db"), migDir);
  db.close();
  // Idempotent so a teardown double-fire (test afterEach + will-quit) does not blow up.
  expect(() => db.close()).not.toThrow();
});
