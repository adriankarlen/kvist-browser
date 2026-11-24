import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { isFirstRun, probeFirstRun } from "./first-run";

describe("isFirstRun", () => {
  it("only when neither config.toml nor a database exists", () => {
    expect(isFirstRun({ configToml: false, database: false })).toBe(true);
    expect(isFirstRun({ configToml: true, database: false })).toBe(false);
    expect(isFirstRun({ configToml: false, database: true })).toBe(false);
  });
});

/** Two fresh directories, and a way to put a file in either. */
const withDirs = <A>(
  body: (dirs: {
    config: string;
    data: string;
    touch: (dir: string, file: string) => Effect.Effect<void>;
    path: Path.Path;
    fs: FileSystem.FileSystem;
  }) => Effect.Effect<A, never, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* fs.makeTempDirectoryScoped().pipe(Effect.orDie);
    const data = yield* fs.makeTempDirectoryScoped().pipe(Effect.orDie);

    const touch = (dir: string, file: string) =>
      fs.writeFileString(path.join(dir, file), "").pipe(Effect.orDie);

    return yield* body({ config, data, touch, path, fs });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("probeFirstRun", () => {
  it.live("a fresh machine is a first run, even with an empty config.css", () =>
    withDirs(({ config, data, touch, path }) =>
      Effect.gen(function* () {
        yield* touch(config, "config.css");

        expect(yield* probeFirstRun(config, path.join(data, "missing"))).toBe(true);
      }),
    ),
  );

  it.live("an existing database means an upgrade, not a first run", () =>
    withDirs(({ config, data, touch }) =>
      Effect.gen(function* () {
        yield* touch(data, "kvist.sqlite");

        expect(yield* probeFirstRun(config, data)).toBe(false);
      }),
    ),
  );

  it.live("the legacy database counts too", () =>
    withDirs(({ config, data, touch }) =>
      Effect.gen(function* () {
        yield* touch(data, "kvist.db");

        expect(yield* probeFirstRun(config, data)).toBe(false);
      }),
    ),
  );

  it.live("a config.toml counts", () =>
    withDirs(({ config, data, touch }) =>
      Effect.gen(function* () {
        yield* touch(config, "config.toml");

        expect(yield* probeFirstRun(config, data)).toBe(false);
      }),
    ),
  );

  it.live("a dangling config.toml symlink counts as a config", () =>
    withDirs(({ config, data, path, fs }) =>
      Effect.gen(function* () {
        yield* fs
          .symlink(path.join(config, "nowhere.toml"), path.join(config, "config.toml"))
          .pipe(Effect.orDie);

        expect(yield* probeFirstRun(config, data)).toBe(false);
      }),
    ),
  );
});
