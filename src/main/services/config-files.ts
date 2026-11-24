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
  Semaphore,
  Stream,
} from "effect";
import {
  DEFAULT_RECIPE,
  DEFAULT_SETTINGS,
  type Problem,
  type UserConfig,
} from "../../shared/config";
import type { RecipeOption } from "../../shared/setup";
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
import { recipeOption, type SetupFiles } from "../setup-files";

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

/** Why the setup wizard wrote nothing. */
export class SetupNotSaved extends Schema.TaggedError<SetupNotSaved>()("SetupNotSaved", {
  reason: Schema.String,
  /** config.toml was there already: the user's own file, which the wizard must give way to. */
  exists: Schema.Boolean,
}) {}

/** The two hand-edited files, as text. */
interface ConfigText {
  readonly css: string;
  readonly toml: string;
}

/** What the last good parse settled on, so a syntax error mid-edit keeps both. */
interface LastGood {
  readonly settings: UserConfig["settings"];
  readonly recipe: string;
}

/** Before any load: the defaults, and the recipe a config that names none gets. */
const FRESH: LastGood = { settings: DEFAULT_SETTINGS, recipe: DEFAULT_RECIPE };

export class ConfigFiles extends Context.Service<
  ConfigFiles,
  {
    /** The config now, then again after every save. Watching stops when the stream does. */
    readonly changes: Stream.Stream<LoadedConfig>;
    /** Points config.toml's `recipe` at `name`. The watcher then applies it like any save. */
    readonly setRecipe: (name: string) => Effect.Effect<void, RecipeNotSaved>;
    /**
     * The config these files would load as, without writing them. No `css`
     * keeps config.css as it is on disk.
     */
    readonly preview: (files: SetupFiles) => Effect.Effect<LoadedConfig>;
    /** Every recipe that can be picked, with its name and the settings it brings. */
    readonly recipeOptions: Effect.Effect<ReadonlyArray<RecipeOption>>;
    readonly cssExists: Effect.Effect<boolean>;
    /** Creates config.toml, and config.css when given. Never replaces a file that exists. */
    readonly writeFirstRun: (files: SetupFiles) => Effect.Effect<void, SetupNotSaved>;
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

        /** The pipeline every config goes through, wherever its text came from. */
        const loadText = (
          { css, toml }: ConfigText,
          last: LastGood,
        ): Effect.Effect<readonly [LastGood, LoadedConfig]> =>
          Effect.gen(function* () {
            const entries = yield* listRecipes;
            const chosen = readRecipeName(toml, last.recipe);
            const user = listUserRecipes(entries);
            const resolved = resolveRecipe(chosen.name, user.names);
            const source = yield* readRecipe(resolved.name, resolved.origin);
            const recipe = parseRecipe(resolved.name, source.toml);
            // Kept settings belong to the recipe that built them; if it is gone, start from this one.
            const kept = last.settings.recipe === resolved.name ? last.settings : recipe.base;
            const parsed = parseSettings(toml, kept, recipe.base);

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

            return [{ settings: parsed.settings, recipe: chosen.name }, loaded] as const;
          });

        const load = (last: LastGood): Effect.Effect<readonly [LastGood, [LoadedConfig]]> =>
          Effect.all({ css: read(CSS_FILE), toml: read(TOML_FILE) }).pipe(
            Effect.flatMap((text) => loadText(text, last)),
            Effect.map(([good, loaded]) => [good, [loaded]] as const),
          );

        const watch = (ensure: typeof ensureRecipesDir, target: string, what: string) =>
          Stream.unwrap(Effect.as(ensure, fs.watch(target))).pipe(
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
            watch(fs.makeDirectory(dir, { recursive: true }), dir, "the config directory").pipe(
              Stream.filter((event) => event.path === CSS_FILE || event.path === TOML_FILE),
              Stream.as(undefined),
            ),
            // A directory made just before the watch starts reports itself; only recipe files count.
            watch(ensureRecipesDir, recipesDir, "the recipes directory").pipe(
              Stream.filter((event) => /\.(?:css|toml)$/.test(event.path)),
              Stream.as(undefined),
            ),
            Stream.fromQueue(written),
          ],
          { concurrency: "unbounded" },
        ).pipe(Stream.debounce(DEBOUNCE));

        const changes = Stream.concat(Stream.succeed(undefined), saves).pipe(
          Stream.mapAccumEffect(
            (): LastGood => FRESH,
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

        // Where the bytes live: a dotfile repo's symlink is followed, so the link itself survives.
        const realTomlPath = fs
          .realPath(tomlPath)
          .pipe(
            Effect.catchTag("PlatformError", (error) =>
              Predicate.isTagged(error.reason, "NotFound")
                ? Effect.succeed(tomlPath)
                : Effect.fail(error),
            ),
          );

        /** Written beside the target and renamed over it, so a failed write leaves the old file. */
        const replaceAtomically = (target: string, text: string) =>
          Effect.gen(function* () {
            const temp = path.join(
              path.dirname(target),
              `.${path.basename(target)}.kvist-${crypto.randomUUID()}`,
            );

            const mode = yield* fs.stat(target).pipe(
              Effect.map((info) => info.mode & 0o777),
              Effect.orElseSucceed(() => 0o644),
            );

            yield* fs.writeFileString(temp, text, { mode }).pipe(
              Effect.andThen(fs.rename(temp, target)),
              Effect.onError(() => Effect.ignore(fs.remove(temp))),
            );
          });

        // One at a time: two quick `:recipe`s must not read the same file and race to write it.
        const writing = yield* Semaphore.make(1);

        const setRecipe = (name: string): Effect.Effect<void, RecipeNotSaved> =>
          Effect.gen(function* () {
            const edited = withRecipe(yield* readForEdit, name);

            if (Result.isFailure(edited)) return yield* notSaved(edited.failure);

            yield* fs.makeDirectory(dir, { recursive: true });
            yield* replaceAtomically(yield* realTomlPath, edited.success);
            yield* Queue.offer(written, undefined);
          }).pipe(
            Effect.catchTag("PlatformError", (error) =>
              Effect.fail(notSaved(`could not write ${TOML_FILE}: ${error.message}`)),
            ),
            (effect) => writing.withPermit(effect),
          );

        const preview = (files: SetupFiles): Effect.Effect<LoadedConfig> =>
          Effect.map(
            files.css === undefined ? read(CSS_FILE) : Effect.succeed(files.css),
            (css) => ({ css, toml: files.toml }),
          ).pipe(
            Effect.flatMap((text) => loadText(text, FRESH)),
            Effect.map(([, loaded]) => loaded),
          );

        const recipeOptions = Effect.gen(function* () {
          const user = listUserRecipes(yield* listRecipes);

          return yield* Effect.forEach(recipeCatalog(user.names), (name) => {
            const { origin } = resolveRecipe(name, user.names);

            return Effect.map(readRecipe(name, origin), (source) =>
              recipeOption(name, parseRecipe(name, source.toml)),
            );
          });
        });

        const cssExists = fs
          .exists(path.join(dir, CSS_FILE))
          .pipe(
            Effect.catchTag("PlatformError", (error) =>
              Effect.as(Effect.logError(`could not check ${CSS_FILE}`, error), true),
            ),
          );

        /** Exclusive create: a file made since the wizard opened is the user's, and wins. */
        const create = (file: string, text: string) =>
          fs.writeFileString(path.join(dir, file), text, { flag: "wx" });

        const writeFirstRun = (files: SetupFiles): Effect.Effect<void, SetupNotSaved> =>
          Effect.gen(function* () {
            yield* fs.makeDirectory(dir, { recursive: true });
            yield* create(TOML_FILE, files.toml);

            if (files.css !== undefined) {
              yield* create(CSS_FILE, files.css).pipe(
                Effect.catchTag("PlatformError", (error) =>
                  Predicate.isTagged(error.reason, "AlreadyExists")
                    ? Effect.void
                    : Effect.logError(`could not write ${CSS_FILE}`, error),
                ),
              );
            }

            yield* Queue.offer(written, undefined);
          }).pipe(
            Effect.catchTag("PlatformError", (error) =>
              Effect.fail(
                Predicate.isTagged(error.reason, "AlreadyExists")
                  ? new SetupNotSaved({
                      reason: `${TOML_FILE} already exists; it was left as it is`,
                      exists: true,
                    })
                  : new SetupNotSaved({
                      reason: `could not write ${TOML_FILE}: ${error.message}`,
                      exists: false,
                    }),
              ),
            ),
            (effect) => writing.withPermit(effect),
          );

        return { changes, setRecipe, preview, recipeOptions, cssExists, writeFirstRun };
      }),
    );
  }

  static layer = ConfigFiles.layerAt(configDir);
}
