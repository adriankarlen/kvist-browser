import { SqliteClient } from "@effect/sql-sqlite-node";
import { Effect, FileSystem, Layer, Path, String } from "effect";
import { Migrator, type SqlClient, type SqlError } from "effect/sql";

/**
 * Migrations are bundled, not read from disk: an eager glob turns each
 * `NNNN_name.ts` into an entry, so there is no folder to unpack from the
 * asar and nothing to find missing at runtime.
 */
const modules = import.meta.glob<Effect.Effect<void, unknown, SqlClient.SqlClient>>(
  "./migrations/*.ts",
  { eager: true, import: "default" },
);

const migrations = Object.fromEntries(
  Object.entries(modules).map(([file, migration]) => [
    file.replace(/^.*\/(\d+_[^/]+)\.ts$/, "$1"),
    migration,
  ]),
);

const migrate = Migrator.make({})({ loader: Migrator.fromRecord(migrations) });

/** One connection for the app, migrated before anything can query it. */
export function databaseLayer(
  filename: string,
): Layer.Layer<
  SqliteClient.SqliteClient | SqlClient.SqlClient,
  SqlError.SqlError | Migrator.MigrationError
> {
  const client = SqliteClient.layer({
    filename,
    transformResultNames: String.snakeToCamel,
    transformQueryNames: String.camelToSnake,
  });

  return Layer.effectDiscard(Effect.asVoid(migrate)).pipe(Layer.provideMerge(client));
}

/** A private database for one test. Nothing touches the disk. */
export const testDatabase = databaseLayer(":memory:");

/**
 * The file the app keeps its database in, created with its directory. The
 * Drizzle-era `kvist.db` is deleted rather than migrated: its migration
 * bookkeeping belongs to a different tool.
 */
export const prepareDatabaseFile = (
  dir: string,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    yield* fs.makeDirectory(dir, { recursive: true });

    for (const legacy of ["kvist.db", "kvist.db-wal", "kvist.db-shm"]) {
      yield* fs.remove(path.join(dir, legacy), { force: true });
    }

    return path.join(dir, "kvist.sqlite");
  }).pipe(Effect.orDie);
