import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { SqlClient } from "effect/sql";
import { databaseLayer, prepareDatabaseFile, testDatabase } from "./database";

const tables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const rows = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name
  `;

  return rows.map((row) => row.name);
});

describe("database", () => {
  it.effect("migrations create every table", () =>
    Effect.gen(function* () {
      expect(yield* tables).toEqual(
        expect.arrayContaining(["bookmarks", "effect_sql_migrations", "history", "session"]),
      );
    }).pipe(Effect.provide(testDatabase)),
  );

  it.effect("a file database survives a re-open, migrations run once, and WAL is on", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped();
      const file = yield* prepareDatabaseFile(path.join(dir, "nested"));

      const open = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
        Effect.provide(effect, databaseLayer(file));

      yield* open(
        Effect.flatMap(
          Effect.service(SqlClient.SqlClient),
          (sql) => sql`INSERT INTO history (url, title, visited_at) VALUES ('https://a/', 'a', 1)`,
        ),
      );

      const reopened = yield* open(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const [mode] = yield* sql<{ readonly journalMode: string }>`PRAGMA journal_mode`;

          return { rows: yield* sql`SELECT url FROM history`, mode: mode?.journalMode };
        }),
      );

      expect(reopened).toEqual({ rows: [{ url: "https://a/" }], mode: "wal" });
      expect(file.endsWith("nested/kvist.sqlite")).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("the Drizzle-era database is deleted rather than migrated", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped();

      for (const legacy of ["kvist.db", "kvist.db-wal", "kvist.db-shm"]) {
        yield* fs.writeFileString(path.join(dir, legacy), "old");
      }

      yield* prepareDatabaseFile(dir);
      expect(yield* fs.readDirectory(dir)).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
