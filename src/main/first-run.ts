import { Effect, FileSystem, Path } from "effect";

/** What decides a first launch. Both are read before startup creates the database. */
export interface Footprint {
  readonly configToml: boolean;
  readonly database: boolean;
}

/**
 * Only a launch with no config.toml and no database is a first one. Someone
 * who upgrades without ever writing a config still has a database, so they
 * are not shown the wizard.
 */
export const isFirstRun = ({ configToml, database }: Footprint): boolean =>
  !configToml && !database;

/**
 * Must run before the runtime is built, because building it creates the
 * database file. A dangling config.toml symlink counts as a config: someone
 * put it there.
 */
export const probeFirstRun = (
  configDir: string,
  dataDir: string,
): Effect.Effect<boolean, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const exists = (file: string): Effect.Effect<boolean> =>
      fs.exists(file).pipe(
        Effect.flatMap((found) =>
          found ? Effect.succeed(true) : Effect.as(fs.readLink(file), true),
        ),
        Effect.orElseSucceed(() => false),
      );

    const [configToml, sqlite, legacy] = yield* Effect.all([
      exists(path.join(configDir, "config.toml")),
      exists(path.join(dataDir, "kvist.sqlite")),
      exists(path.join(dataDir, "kvist.db")),
    ]);

    return isFirstRun({ configToml, database: sqlite || legacy });
  });
