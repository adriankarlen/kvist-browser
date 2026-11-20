import { Context, Effect, FileSystem, Layer, Path, Stream } from "effect";
import { stylesDir } from "../paths";
import type { UserStyleSource } from "../user-styles";

// Editors rename over the file rather than writing in place, so one save can
// surface as several directory events.
const DEBOUNCE = "50 millis";

/** `*.css` and not dotfile-hidden. Editor swap files fail the suffix (`foo.css~`). */
function isStyleName(name: string): boolean {
  return name.endsWith(".css") && !name.startsWith(".");
}

export class StyleFiles extends Context.Service<
  StyleFiles,
  {
    /**
     * Every style file, sorted by name for a stable injection order: now,
     * then again after every change in the directory. A full rescan each
     * time; diffing buys nothing.
     */
    readonly changes: Stream.Stream<ReadonlyArray<UserStyleSource>>;
  }
>()("kvist/StyleFiles") {
  static layerAt(dir: string): Layer.Layer<StyleFiles, never, FileSystem.FileSystem | Path.Path> {
    return Layer.effect(
      StyleFiles,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const ensureDir = fs.makeDirectory(dir, { recursive: true });

        /**
         * One file, or nothing. `stat` follows symlinks, so a dotfile repo's
         * link into `~/.config` reads like a file, and a directory named
         * `*.css` does not. One bad file must not blank out the rest.
         */
        const readOne = (name: string): Effect.Effect<ReadonlyArray<UserStyleSource>> => {
          const file = path.join(dir, name);

          return Effect.gen(function* () {
            const info = yield* fs.stat(file);

            if (info.type !== "File") return [];

            return [{ id: file, source: yield* fs.readFileString(file) }];
          }).pipe(
            Effect.catchTag("PlatformError", (error) =>
              Effect.as(Effect.logError(`could not read ${name}`, error), []),
            ),
          );
        };

        const scan: Effect.Effect<ReadonlyArray<UserStyleSource>> = Effect.gen(function* () {
          yield* ensureDir;
          const names = (yield* fs.readDirectory(dir)).filter(isStyleName).sort();
          const files = yield* Effect.forEach(names, readOne, { concurrency: "unbounded" });

          return files.flat();
        }).pipe(
          Effect.catchTag("PlatformError", (error) =>
            Effect.as(Effect.logError("could not list the styles directory", error), []),
          ),
        );

        // An unwatchable directory leaves the styles that were read in force.
        const edits = Stream.unwrap(Effect.as(ensureDir, fs.watch(dir))).pipe(
          Stream.catchTag("PlatformError", (error) =>
            Stream.fromEffect(Effect.logError("could not watch the styles directory", error)).pipe(
              Stream.drain,
            ),
          ),
          Stream.debounce(DEBOUNCE),
        );

        // Sequential, so a slow rescan can never land after a newer one.
        const changes = Stream.concat(Stream.succeed(undefined), edits).pipe(
          Stream.mapEffect(() => scan),
        );

        return { changes };
      }),
    );
  }

  static layer = StyleFiles.layerAt(stylesDir);
}
