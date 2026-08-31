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
 * - **Dev** (`VITE_DEV_SERVER_URL` is set): the main process is served as
 *   ESM by vite-plugin-electron, so `import.meta.url` is an `http://`
 *   URL — `fileURLToPath` would throw on it. The migrations live at the
 *   source tree instead, and `app.getAppPath()` points at the project
 *   root regardless of the working directory the user launched from.
 * - **Prod** (bundled): the main bundle sits at `dist/main/index.js` and
 *   the build copies the migrations to `dist/main/migrations/`
 *   alongside it. `fileURLToPath` is the safe way to derive a filesystem
 *   path from a `file://` URL — `.pathname` decodes percent escapes and
 *   mangles a path containing a space.
 * - **Tests**: same as prod, because vite-plus' test runner uses Vite's
 *   module graph, and `import.meta.url` is the source file's URL.
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
 * `app.whenReady`, released on `will-quit`, never re-opened. The
 * underlying Drizzle instance is exposed so consumers (KVI-25/26/27, the
 * `Permissions` migration to disk) compose queries against it directly.
 *
 * The driver is `node:sqlite` (Node's built-in module) precisely so Electron
 * version bumps do not trigger a native-module rebuild dance — that is the
 * whole reason this class exists.
 */
export class Database {
  /** The underlying `DatabaseSync`. Held for `close()`; not part of the public API. */
  #client: DatabaseSync;
  /** The Drizzle wrapper; what consumers query against. */
  #db: NodeSQLiteDatabase;
  /** Whether `close()` has been called. Tracked so a second call is a no-op. */
  #closed = false;

  private constructor(client: DatabaseSync, db: NodeSQLiteDatabase) {
    this.#client = client;
    this.#db = db;
  }

  /**
   * Opens a SQLite database at `path`, runs any pending migrations from
   * `migrationsFolder`, and returns the wrapped `Database`. The parent
   * directory is created if it does not exist, so first-launch never fails
   * on a missing `~/.local/share/kvist/`.
   *
   * `node:sqlite` is fully synchronous, so `open` is too: there is no I/O
   * that has not already completed by the time this returns. The plan
   * originally said `async`; it is `sync` because that is what the
   * underlying APIs give us, and pretending otherwise would just be
   * `await Promise.resolve()` everywhere.
   *
   * Throws on a bad migration or a corrupted DB. Callers that should not
   * let a startup failure leave the user staring at an empty window wrap
   * this in a try/catch and `app.quit()` on failure — see `index.ts`.
   */
  static open(path: string, migrationsFolder: string = defaultMigrationsFolder()): Database {
    mkdirSync(dirname(path), { recursive: true });
    const client = new DatabaseSync(path);

    // WAL lets readers not block writers, which matters once multiple
    // consumers touch the same DB. `foreign_keys` is off by default in
    // SQLite; we want ON, because the schema relies on FK constraints.
    // `busy_timeout` is a defense against a second writer stepping on the
    // first within a transaction; the default of zero would error
    // immediately, which is not what a browser wants from its own DB.
    client.exec("PRAGMA journal_mode = WAL");
    client.exec("PRAGMA foreign_keys = ON");
    client.exec("PRAGMA busy_timeout = 5000");

    const db = drizzle({ client });
    // The migrator manages its own `__drizzle_migrations` table; calling it
    // on an empty folder is a no-op, which is the state this ticket ships
    // in. Future tickets add tables to `schema.ts` and run `pnpm
    // db:generate` to write the SQL.
    migrate(db, { migrationsFolder });

    return new Database(client, db);
  }

  /**
   * The Drizzle instance. Exposed rather than wrapped because the query
   * builder is the whole point of using Drizzle, and a thin wrapper would
   * either forward every call (and drift out of sync with the API) or
   * hide the methods that consumers actually need.
   */
  get drizzle(): NodeSQLiteDatabase {
    return this.#db;
  }

  /**
   * Closes the underlying connection. Idempotent — a second call is a
   * no-op, so a `will-quit` handler does not have to coordinate with a
   * test teardown. A `Database` is single-use: closing it leaves the
   * object valid as a no-op but `drizzle` will throw on the next query.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#client.close();
  }
}
