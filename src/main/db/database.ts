import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { DatabaseSync } from "node:sqlite";
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";

/**
 * Where the runtime finds migrations. In dev they live at the source tree,
 * `app.getAppPath()` being the project root; in prod they sit beside
 * `dist/main/index.js`. `fileURLToPath`, not `.pathname`, so paths with
 * spaces survive.
 */
export function defaultMigrationsFolder(): string {
  if (process.env.VITE_DEV_SERVER_URL !== undefined) {
    return join(app.getAppPath(), "src", "main", "db", "migrations");
  }
  return fileURLToPath(new URL("./migrations/", import.meta.url));
}

/**
 * The single connection to SQLite. App-scoped like `Downloads` and
 * `Permissions`: opened once in `app.whenReady`, released on quit, never
 * re-opened; `drizzle` is exposed so consumers compose queries. The driver
 * is `node:sqlite`, which is why version bumps never trigger a native
 * rebuild.
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
   * Opens the database, migrates, and returns the wrapped connection,
   * creating the parent directory so first launch never misses the folder.
   * Throws on bad migrations or a corrupt DB — `index.ts` quits, so a
   * failed startup leaves no windowless process.
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
    // An empty folder is a no-op for the migrator (the state this
    // ticket ships in). A missing one is not: electron-builder drops
    // `.gitkeep`, so the packaged app has no `migrations` folder at
    // all, and the migrator throws ENOENT instead of treating that as
    // zero migrations. Skip it rather than throw; skip rather than
    // create it, because packaged files live in a read-only asar.
    //
    // The try/catch is a second-line defense: `existsSync` lies for
    // paths inside an asar (returns true for files that exist only
    // virtually), but `migrate` reaches for `readdirSync`, which does
    // not. The package config unpacks migrations outside the asar
    // (see `package.json#build.asarUnpack`), so this only fires if
    // something else is wrong — better to log and skip than to crash
    // a window-less startup.
    if (existsSync(migrationsFolder)) {
      try {
        migrate(db, { migrationsFolder });
      } catch (error) {
        console.error("kvist: could not run migrations:", error);
      }
    }

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
