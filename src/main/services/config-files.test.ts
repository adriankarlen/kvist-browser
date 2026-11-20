import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Queue, Stream } from "effect";
import type { Scope } from "effect";
import { DEFAULT_SETTINGS } from "../../shared/config";
import { ConfigFiles, describeProblem, type LoadedConfig } from "./config-files";

const withDir = <A, E>(
  body: (
    write: (file: string, text: string) => Effect.Effect<void>,
  ) => Effect.Effect<A, E, ConfigFiles | Scope.Scope>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped();

    const write = (file: string, text: string) =>
      fs.writeFileString(path.join(dir, file), text).pipe(Effect.orDie);

    return yield* body(write).pipe(Effect.provide(ConfigFiles.layerAt(dir)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

/** Collects the config stream into a queue so a test can take one load at a time. */
const subscribe = Effect.gen(function* () {
  const { changes } = yield* ConfigFiles;
  const queue = yield* Queue.unbounded<LoadedConfig>();

  yield* changes.pipe(
    Stream.runForEach((loaded) => Queue.offer(queue, loaded)),
    Effect.forkScoped,
  );

  return queue;
});

describe("ConfigFiles", () => {
  it.live("emits the current config first, with missing files as defaults", () =>
    withDir(() =>
      Effect.gen(function* () {
        const loads = yield* subscribe;
        const first = yield* Queue.take(loads);

        expect(first).toEqual({ config: { css: "", settings: DEFAULT_SETTINGS }, problems: [] });
      }),
    ),
  );

  it.live("emits again after a save, and a syntax error keeps the last good settings", () =>
    withDir((write) =>
      Effect.gen(function* () {
        const loads = yield* subscribe;

        yield* Queue.take(loads);
        yield* Effect.sleep("20 millis");
        yield* write("config.toml", 'homepage = "https://kept.example"');

        const saved = yield* Queue.take(loads);

        expect(saved.config.settings.homepage).toBe("https://kept.example");

        yield* write("config.toml", "homepage = ");
        const broken = yield* Queue.take(loads);

        expect(broken.config.settings.homepage).toBe("https://kept.example");
        expect(broken.problems.map(describeProblem)[0]).toMatch(/^config\.toml: .*line 1, column/);
      }),
    ),
  );

  it.live("ignores files other than config.css and config.toml", () =>
    withDir((write) =>
      Effect.gen(function* () {
        const loads = yield* subscribe;

        yield* Queue.take(loads);
        yield* write("notes.txt", "hello");
        yield* Effect.sleep("150 millis");
        expect(yield* Queue.size(loads)).toBe(0);
      }),
    ),
  );
});
