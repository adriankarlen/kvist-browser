import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Predicate,
  Queue,
  Result,
  Schema,
  Stream,
} from "effect";
import {
  DEFAULT_RECIPE,
  DEFAULT_SETTINGS,
  type Problem,
  type UserConfig,
} from "../../shared/config";
import { withRecipe } from "../config-edit";
import { configDir } from "../paths";
import {
  BUILT_IN,
  listUserRecipes,
  parseRecipe,
  recipeCatalog,
  recipeFile,
  resolveRecipe,
  type RecipeSource,
} from "../recipes";
import { parseSettings, readRecipeName } from "../settings";

const CSS_FILE = "config.css";
const TOML_FILE = "config.toml";
const RECIPES_DIR = "recipes";

// Editors rename over the file rather than writing in place, so one save can
// surface as several directory events.
const DEBOUNCE = "50 millis";

/** A config and everything wrong with it; the caller decides who is told. */
export interface LoadedConfig {
  readonly config: UserConfig;
  readonly problems: ReadonlyArray<Problem>;
  /** Every recipe that can be picked, user and built-in. */
  readonly recipes: ReadonlyArray<string>;
}

/** Why `:recipe` left config.toml as it was. */
export class RecipeNotSaved extends Schema.TaggedError<RecipeNotSaved>()("RecipeNotSaved", {
  reason: Schema.String,
}) {}

/** What the last good parse settled on, so a syntax error mid-edit keeps both. */
interface LastGood {
  readonly settings: UserConfig["settings"];
  readonly recipe: string;
}

export class ConfigFiles extends Context.Service<
  ConfigFiles,
  {
    /** The config now, then again after every save. Watching stops when the stream does. */
    readonly changes: Stream.Stream<LoadedConfig>;
    /** Points config.toml's `recipe` at `name`. The watcher then applies it like any save. */
    readonly setRecipe: (name: string) => Effect.Effect<void, RecipeNotSaved>;
  }
>()("kvist/ConfigFiles") {
  static layerAt(dir: string): Layer.Layer<ConfigFiles, never, FileSystem.FileSystem | Path.Path> {
    return Layer.effect(
      ConfigFiles,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const recipesDir = path.join(dir, RECIPES_DIR);

        /** A file's text; missing is `undefined`, and any other failure is logged and empty. */
        const readOptional = (file: string): Effect.Effect<string | undefined> =>
          fs
            .readFileString(path.join(dir, file))
            .pipe(
              Effect.catchTag("PlatformError", (error) =>
                Predicate.isTagged(error.reason, "NotFound")
                  ? Effect.succeed(undefined)
                  : Effect.as(Effect.logError(`could not read ${file}`, error), ""),
              ),
            );

        const read = (file: string): Effect.Effect<string> =>
          Effect.map(readOptional(file), (text) => text ?? "");

        // Creating it saves anyone writing a first recipe the guesswork of where it goes.
        const ensureRecipesDir = fs.makeDirectory(recipesDir, { recursive: true });

        const listRecipes: Effect.Effect<ReadonlyArray<string>> = Effect.andThen(
          ensureRecipesDir,
          fs.readDirectory(recipesDir),
        ).pipe(
          Effect.catchTag("PlatformError", (error) =>
            Effect.as(Effect.logError("could not list the recipes directory", error), []),
          ),
        );

        const readRecipe = (
          name: string,
          origin: "user" | "builtin",
        ): Effect.Effect<RecipeSource> =>
          origin === "builtin"
            ? Effect.succeed(BUILT_IN.get(name) ?? { css: "", toml: undefined })
            : Effect.all({
                css: read(recipeFile(name, "css")),
                toml: readOptional(recipeFile(name, "toml")),
              });

        const load = (last: LastGood): Effect.Effect<readonly [LastGood, [LoadedConfig]]> =>
          Effect.gen(function* () {
            const { css, toml, entries } = yield* Effect.all({
              css: read(CSS_FILE),
              toml: read(TOML_FILE),
              entries: listRecipes,
            });

            const chosen = readRecipeName(toml, last.recipe);
            const user = listUserRecipes(entries);
            const resolved = resolveRecipe(chosen.name, user.names);
            const source = yield* readRecipe(resolved.name, resolved.origin);
            const recipe = parseRecipe(resolved.name, source.toml);
            const parsed = parseSettings(toml, last.settings, recipe.base);

            const loaded: LoadedConfig = {
              config: {
                css,
                recipe: { name: resolved.name, css: source.css },
                settings: parsed.settings,
              },
              problems: [
                ...parsed.problems,
                ...chosen.problems,
                ...resolved.problems,
                ...recipe.problems,
                ...user.problems,
              ],
              recipes: recipeCatalog(user.names),
            };

            return [{ settings: parsed.settings, recipe: chosen.name }, [loaded]] as const;
          });

        const watch = (target: string, what: string) =>
          Stream.unwrap(Effect.as(ensureRecipesDir, fs.watch(target))).pipe(
            Stream.catchTag("PlatformError", (error) =>
              Stream.fromEffect(Effect.logError(`could not watch ${what}`, error)).pipe(
                Stream.drain,
              ),
            ),
          );

        // A symlinked config.toml is written at its target, which the directory watch never sees.
        const written = yield* Queue.unbounded<void>();

        // Two watches: neither is recursive, and the config directory also holds styles/.
        const saves = Stream.mergeAll(
          [
            watch(dir, "the config directory").pipe(
              Stream.filter((event) => event.path === CSS_FILE || event.path === TOML_FILE),
              Stream.as(undefined),
            ),
            // A directory made just before the watch starts reports itself; only recipe files count.
            watch(recipesDir, "the recipes directory").pipe(
              Stream.filter((event) => /\.(?:css|toml)$/.test(event.path)),
              Stream.as(undefined),
            ),
            Stream.fromQueue(written),
          ],
          { concurrency: "unbounded" },
        ).pipe(Stream.debounce(DEBOUNCE));

        const changes = Stream.concat(Stream.succeed(undefined), saves).pipe(
          Stream.mapAccumEffect(
            (): LastGood => ({ settings: DEFAULT_SETTINGS, recipe: DEFAULT_RECIPE }),
            (last) => load(last),
          ),
        );

        const notSaved = (reason: string) => new RecipeNotSaved({ reason });
        const tomlPath = path.join(dir, TOML_FILE);

        // A read failure must not look like an empty file, or the write would wipe the config.
        const readForEdit = fs
          .readFileString(tomlPath)
          .pipe(
            Effect.catchTag("PlatformError", (error) =>
              Predicate.isTagged(error.reason, "NotFound")
                ? Effect.succeed("")
                : Effect.fail(notSaved(`could not read ${TOML_FILE}: ${error.message}`)),
            ),
          );

        // In place, not renamed over: a dotfile repo's symlink must stay a symlink.
        const setRecipe = (name: string): Effect.Effect<void, RecipeNotSaved> =>
          Effect.gen(function* () {
            const edited = withRecipe(yield* readForEdit, name);

            if (Result.isFailure(edited)) return yield* notSaved(edited.failure);

            yield* fs.makeDirectory(dir, { recursive: true });
            yield* fs.writeFileString(tomlPath, edited.success);
            yield* Queue.offer(written, undefined);
          }).pipe(
            Effect.catchTag("PlatformError", (error) =>
              Effect.fail(notSaved(`could not write ${TOML_FILE}: ${error.message}`)),
            ),
          );

        return { changes, setRecipe };
      }),
    );
  }

  static layer = ConfigFiles.layerAt(configDir);
}
