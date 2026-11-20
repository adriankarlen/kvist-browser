import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Queue, Stream } from "effect";
import type { Scope } from "effect";
import type { UserStyleSource } from "../user-styles";
import { StyleFiles } from "./style-files";

interface Dir {
  readonly root: string;
  readonly write: (name: string, text: string) => Effect.Effect<void>;
  readonly make: (name: string) => Effect.Effect<void>;
  readonly link: (target: string, name: string) => Effect.Effect<void>;
}

const inTempDir = <A, E>(
  sub: string,
  body: (dir: Dir) => Effect.Effect<A, E, StyleFiles | Scope.Scope>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped();
    const at = (name: string) => path.join(root, name);

    const dir: Dir = {
      root,
      write: (name, text) => fs.writeFileString(at(name), text).pipe(Effect.orDie),
      make: (name) => fs.makeDirectory(at(name), { recursive: true }).pipe(Effect.orDie),
      link: (target, name) => fs.symlink(at(target), at(name)).pipe(Effect.orDie),
    };

    return yield* body(dir).pipe(Effect.provide(StyleFiles.layerAt(path.join(root, sub))));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const subscribe = Effect.gen(function* () {
  const { changes } = yield* StyleFiles;
  const queue = yield* Queue.unbounded<ReadonlyArray<UserStyleSource>>();

  yield* changes.pipe(
    Stream.runForEach((sources) => Queue.offer(queue, sources)),
    Effect.forkScoped,
  );

  return queue;
});

const names = (sources: ReadonlyArray<UserStyleSource>) =>
  sources.map((source) => source.id.split("/").at(-1));

describe("StyleFiles", () => {
  it.live("a missing directory is created, and yields no sources", () =>
    inTempDir("styles", () =>
      Effect.gen(function* () {
        expect(yield* Queue.take(yield* subscribe)).toEqual([]);
      }),
    ),
  );

  it.live("reads only visible .css files and symlinks to them, sorted by name", () =>
    inTempDir("styles", (dir) =>
      Effect.gen(function* () {
        yield* dir.make("styles/dir.css");
        yield* dir.write("styles/b.css", "b {}");
        yield* dir.write("styles/a.css", "a {}");
        yield* dir.write("styles/.hidden.css", "h {}");
        yield* dir.write("styles/notes.txt", "n");
        yield* dir.write("styles/swap.css~", "s");
        yield* dir.write("linked.css", "l {}");
        yield* dir.link("linked.css", "styles/c.css");

        const first = yield* Queue.take(yield* subscribe);

        expect(names(first)).toEqual(["a.css", "b.css", "c.css"]);
        expect(first.map((source) => source.source)).toEqual(["a {}", "b {}", "l {}"]);
      }),
    ),
  );

  it.live("a change triggers a rescan that sees the latest contents", () =>
    inTempDir("styles", (dir) =>
      Effect.gen(function* () {
        const loads = yield* subscribe;

        yield* Queue.take(loads);
        yield* Effect.sleep("20 millis");
        yield* dir.write("styles/a.css", "1");
        yield* dir.write("styles/b.css", "2");
        yield* dir.write("styles/a.css", "3");

        // The platform may split one burst into a few events, so read until it settles.
        let latest = yield* Queue.take(loads);

        while (latest.map((source) => source.source).join() !== "3,2") {
          latest = yield* Queue.take(loads);
        }

        expect(names(latest)).toEqual(["a.css", "b.css"]);
      }),
    ).pipe(Effect.timeout("3 seconds")),
  );

  it.live("a directory that cannot be created yields nothing rather than failing", () =>
    inTempDir("blocker/styles", (dir) =>
      Effect.gen(function* () {
        yield* dir.write("blocker", "not a directory");
        expect(yield* Queue.take(yield* subscribe)).toEqual([]);
      }),
    ),
  );
});
