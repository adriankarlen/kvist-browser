import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { DatabaseSync } from "node:sqlite";
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";

/**
 * Where the runtime should look for SQL migrations.
 *
 * In dev the main process is served as ESM, so `import.meta.url` is an
 * `http://` URL and `fileURLToPath` would throw on it — the migrations
 * live at the source tree, and `app.getAppPath()` is the project root
 * regardless of the working directory. In prod the bundle sits at
 * `dist/main/index.js` and the build copies the migrations to
 * `dist/main/migrations/` alongside it; `fileURLToPath` (not `.pathname`,
 * which decodes percent escapes) handles paths with spaces.
 */
export function defaultMigrationsFolder(): string {
  if (process.env.VITE_DEV_SERVER_URL !== undefined) {
    return join(app.getAppPath(), "src", "main", "db", "migrations");
  }
  return fileURLToPath(new URL("./migrations/", import.meta.url));
}

/**
 * The single connection the app holds to its SQLite database. App-scoped,
 * like `Downloads` / `Permissions` / `ZoomStore`: opened once in
 * `app.whenReady`, released on `will-quit`, never re-opened. The Drizzle
 * instance is exposed so consumers compose queries against it directly.
 *
 * The driver is `node:sqlite` so Electron version bumps never trigger a
 * native-module rebuild dance — that is the whole reason this class exists.
 */
export class Database {
  #client: DatabaseSync;
  #db: NodeSQLiteDatabase;
  #closed = false;

  private constructor(client: DatabaseSync, db: NodeSQLiteDatabase) {
    this.#client = client;
    this.#db = db;
  }

  /**
   * Opens the database, runs pending migrations, and returns the wrapped
   * connection. The parent directory is created so first launch never
   * fails on a missing `~/.local/share/kvist/`. Throws on a bad
   * migration or corrupted DB — `index.ts` catches and quits so a
   * startup failure does not leave the process alive with no window.
   */
  static open(path: string, migrationsFolder: string = defaultMigrationsFolder()): Database {
    mkdirSync(dirname(path), { recursive: true });
    const client = new DatabaseSync(path);

    // WAL lets readers not block writers, which matters once multiple
    // consumers share the file. `foreign_keys` is off by default in
    // SQLite; the schema relies on FK constraints. `busy_timeout`
    // defaults to zero, which would error the moment a second writer
    // stepped on a transaction.
    client.exec("PRAGMA journal_mode = WAL");
    client.exec("PRAGMA foreign_keys = ON");
    client.exec("PRAGMA busy_timeout = 5000");

    const db = drizzle({ client });
    // The migrator manages its own bookkeeping table, so an empty folder
    // is a no-op (the state this ticket ships in).
    migrate(db, { migrationsFolder });

    return new Database(client, db);
  }

  /** The Drizzle instance. Exposed rather than wrapped: a thin wrapper would drift out of sync with the API. */
  get drizzle(): NodeSQLiteDatabase {
    return this.#db;
  }

  /**
   * Closes the underlying connection. Idempotent so a `will-quit`
   * handler does not have to coordinate with a test teardown. A
   * `Database` is single-use: closing it leaves the object valid as a
   * no-op but `drizzle` will throw on the next query.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#client.close();
  }
}
