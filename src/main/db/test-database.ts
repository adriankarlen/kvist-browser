import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "./database";

const REAL_MIGRATIONS = join(process.cwd(), "src/main/db/migrations");

/** A store test's DB handle, and the temp directory it lives in so teardown can wipe it. */
export interface TestDatabase {
  dir: string;
  db: Database;
}

/**
 * Opens a throwaway, fully-migrated SQLite DB for a store test. Copies the
 * real migrations into a fresh temp directory so `Database.open` runs them
 * against a folder that is not the project's own `kvist.db` — every store
 * test (`history.test.ts`, `bookmarks.test.ts`, `omnibox.test.ts`, ...)
 * wants exactly this, so it lives here once rather than once per file.
 *
 * `label` names the temp directory (e.g. `"history"`) purely so a leftover
 * one after a crashed run is identifiable by hand; it has no effect on the
 * test itself.
 */
export function openTestDatabase(label: string): TestDatabase {
  const dir = mkdtempSync(join(tmpdir(), `kvist-${label}-`));
  const migDir = join(dir, "migrations");
  mkdirSync(migDir, { recursive: true });

  for (const entry of readdirSync(REAL_MIGRATIONS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    cpSync(join(REAL_MIGRATIONS, entry.name), join(migDir, entry.name), {
      recursive: true,
    });
  }

  const db = Database.open(join(dir, `${label}.db`), migDir);
  return { dir, db };
}

/** Closes the connection and wipes the temp directory `openTestDatabase` created. */
export function closeTestDatabase({ dir, db }: TestDatabase): void {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
