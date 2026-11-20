import { Context, Effect, FileSystem, Layer, Path, Predicate, Stream } from "effect";
import {
  DEFAULT_SETTINGS,
  type Problem,
  type Settings,
  type UserConfig,
} from "../../shared/config";
import { configDir } from "../paths";
import { parseSettings } from "../settings";

const CSS_FILE = "config.css";
const TOML_FILE = "config.toml";

// Editors rename over the file rather than writing in place, so one save can
// surface as several directory events.
const DEBOUNCE = "50 millis";

/** A config and everything wrong with it; the caller decides who is told. */
export interface LoadedConfig {
  readonly config: UserConfig;
  readonly problems: ReadonlyArray<Problem>;
}

/** How a problem reads to a user: which file, which field, and why. */
export function describeProblem({ field, reason }: Problem): string {
  // A problem with the file itself names the file as its field; saying so
  // twice reads as a bug.
  const where = field === TOML_FILE ? TOML_FILE : `${TOML_FILE}: ${field}`;

  return `${where}: ${reason}`;
}

interface RawConfig {
  readonly css: string;
  readonly toml: string;
}

/**
 * Parses one read against the settings that last parsed, so a syntax error
 * mid-edit keeps them rather than reverting to the defaults.
 */
function parseAgainst(
  lastGood: Settings,
  raw: RawConfig,
): readonly [Settings, ReadonlyArray<LoadedConfig>] {
  const { settings, problems } = parseSettings(raw.toml, lastGood);

  return [settings, [{ config: { css: raw.css, settings }, problems }]];
}

export class ConfigFiles extends Context.Service<
  ConfigFiles,
  {
    /** The config now, then again after every save. Watching stops when the stream does. */
    readonly changes: Stream.Stream<LoadedConfig>;
  }
>()("kvist/ConfigFiles") {
  static layerAt(dir: string): Layer.Layer<ConfigFiles, never, FileSystem.FileSystem | Path.Path> {
    return Layer.effect(
      ConfigFiles,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const read = (file: string): Effect.Effect<string> =>
          fs
            .readFileString(path.join(dir, file))
            .pipe(
              Effect.catchTag("PlatformError", (error) =>
                Predicate.isTagged(error.reason, "NotFound")
                  ? Effect.succeed("")
                  : Effect.as(Effect.logError(`could not read ${file}`, error), ""),
              ),
            );

        const readBoth = Effect.all({ css: read(CSS_FILE), toml: read(TOML_FILE) });

        const saves = Stream.unwrap(
          fs.makeDirectory(dir, { recursive: true }).pipe(
            Effect.as(fs.watch(dir)),
            Effect.catchTag("PlatformError", (error) =>
              Effect.as(Effect.logError("config watch failed", error), Stream.empty),
            ),
          ),
        ).pipe(
          Stream.filter((event) => event.path === CSS_FILE || event.path === TOML_FILE),
          Stream.catchTag("PlatformError", (error) =>
            Stream.fromEffect(Effect.logError("config watch failed", error)).pipe(Stream.drain),
          ),
          Stream.debounce(DEBOUNCE),
        );

        const changes = Stream.concat(Stream.succeed(undefined), saves).pipe(
          Stream.mapEffect(() => readBoth),
          Stream.mapAccum(() => DEFAULT_SETTINGS, parseAgainst),
        );

        return { changes };
      }),
    );
  }

  static layer = ConfigFiles.layerAt(configDir);
}
