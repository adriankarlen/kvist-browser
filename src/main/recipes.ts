import { Result, Schema } from "effect";
import { Toml } from "effect/encoding";
import { DEFAULT_RECIPE, type Problem, type Settings } from "../shared/config";
import { RecipeName } from "../shared/schema/config";
import { builtInEngine, builtInKeymap } from "./keymaps";
import { BASE_SETTINGS, parseKeymapName, parseLayout } from "./settings";
import { read } from "./toml-fields";

/** A recipe as read: the CSS that makes it exist, and the defaults file it may carry. */
export interface RecipeSource {
  readonly css: string;
  readonly toml: string | undefined;
}

/**
 * Bundled, not read from disk, like the migrations: nothing to unpack from
 * the asar, and nothing to find missing at runtime.
 */
const bundled = import.meta.glob<string>("./recipes/*.{css,toml}", {
  query: "?raw",
  import: "default",
  eager: true,
});

const bundledFile = (name: string, extension: string): string | undefined =>
  bundled[`./recipes/${name}.${extension}`];

/** The recipes Kvist ships, by name. */
export const BUILT_IN: ReadonlyMap<string, RecipeSource> = new Map(
  Object.keys(bundled).flatMap((file) => {
    const name = /^\.\/recipes\/([^/]+)\.css$/.exec(file)?.[1];

    if (name === undefined) return [];
    const css = bundledFile(name, "css") ?? "";

    return [[name, { css, toml: bundledFile(name, "toml") }]];
  }),
);

/** Where a recipe's files live, relative to the config directory. Problems name it. */
export const recipeFile = (name: string, extension: "css" | "toml"): string =>
  `recipes/${name}.${extension}`;

const isRecipeName = Schema.is(RecipeName);

export interface UserRecipes {
  /** Every user recipe, by name: a `.css` with a usable name. */
  readonly names: ReadonlyArray<string>;
  readonly problems: ReadonlyArray<Problem>;
}

/**
 * Which user recipes a directory listing holds. A `.toml` alone is not a
 * recipe: the CSS is what makes one, so an orphan is reported rather than
 * applied as a look-less recipe.
 */
export function listUserRecipes(entries: ReadonlyArray<string>): UserRecipes {
  const problems: Problem[] = [];

  const stems = (extension: string): string[] =>
    entries.flatMap((entry) =>
      entry.endsWith(`.${extension}`) && !entry.startsWith(".")
        ? [entry.slice(0, -extension.length - 1)]
        : [],
    );

  const css = stems("css");
  const names: string[] = [];

  for (const stem of css) {
    if (isRecipeName(stem)) {
      names.push(stem);
    } else {
      const file = recipeFile(stem, "css");

      problems.push({
        file,
        field: file,
        reason: 'not a recipe name: lowercase letters, digits and "-"',
      });
    }
  }

  for (const stem of stems("toml")) {
    if (css.includes(stem)) continue;
    const file = recipeFile(stem, "toml");

    problems.push({
      file,
      field: file,
      reason: `no ${recipeFile(stem, "css")} beside it; ignored`,
    });
  }

  return { names: names.sort(), problems };
}

/** Every recipe that can be picked: the user's and the built-in ones, once each. */
export function recipeCatalog(user: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set([...user, ...BUILT_IN.keys()])].sort();
}

export interface ResolvedRecipe {
  readonly name: string;
  /** A user recipe shadows a built-in one of the same name. */
  readonly origin: "user" | "builtin";
  readonly problems: ReadonlyArray<Problem>;
}

const quoted = (names: ReadonlyArray<string>): string => names.map((n) => `"${n}"`).join(", ");

/** Where the named recipe comes from. An unknown name falls back to the default recipe. */
export function resolveRecipe(name: string, user: ReadonlyArray<string>): ResolvedRecipe {
  const origin = (candidate: string): ResolvedRecipe["origin"] | undefined => {
    if (user.includes(candidate)) return "user";

    return BUILT_IN.has(candidate) ? "builtin" : undefined;
  };

  const found = origin(name);

  if (found !== undefined) return { name, origin: found, problems: [] };

  return {
    name: DEFAULT_RECIPE,
    origin: origin(DEFAULT_RECIPE) ?? "builtin",
    problems: [
      {
        field: "recipe",
        reason: `no recipe named "${name}"; available: ${quoted(recipeCatalog(user))}`,
      },
    ],
  };
}

/**
 * The preset a recipe names. A user preset is only known once config.toml is
 * read, so until then it keeps the base keys under its own name.
 */
function recipeKeys(name: string, base: Settings): Pick<Settings, "inputMode" | "keymap"> {
  const engine = builtInEngine(name);

  if (engine === undefined) return { inputMode: base.inputMode, keymap: { ...base.keymap, name } };

  return { inputMode: engine, keymap: builtInKeymap(engine) };
}

/** The recipe format this Kvist reads. Bump it only for a change an older Kvist would misread. */
const FORMAT = 1;

const RECIPE_KEYS: ReadonlyArray<string> = ["format", "name", "description", "input", "layout"];

export interface RecipeMeta {
  readonly name?: string;
  readonly description?: string;
}

export interface ParsedRecipe {
  /** The settings config.toml is parsed over: the defaults with the recipe's own applied. */
  readonly base: Settings;
  readonly meta: RecipeMeta;
  readonly problems: ReadonlyArray<Problem>;
}

/**
 * Reads a recipe's TOML. A recipe sets defaults for input and layout only;
 * anything else is config.toml's to say. A format this Kvist does not know
 * skips the file, but the recipe's CSS still applies.
 */
export function parseRecipe(name: string, toml: string | undefined): ParsedRecipe {
  const base: Settings = { ...BASE_SETTINGS, recipe: name };
  const file = recipeFile(name, "toml");
  const problems: Problem[] = [];

  const result = (settings: Settings, meta: RecipeMeta = {}): ParsedRecipe => ({
    base: settings,
    meta,
    problems: problems.map((problem) => ({ ...problem, file })),
  });

  if (toml === undefined) return result(base);
  const parsed = Toml.parse(toml);

  if (Result.isFailure(parsed)) {
    problems.push({ field: file, reason: parsed.failure.message });

    return result(base);
  }

  const root = parsed.success;

  if (root.format === undefined) {
    problems.push({ field: file, reason: `no format; add format = ${FORMAT}` });

    return result(base);
  }

  if (root.format !== FORMAT) {
    problems.push({ field: "format", reason: `only format ${FORMAT} is supported; file skipped` });

    return result(base);
  }

  for (const key of Object.keys(root)) {
    if (!RECIPE_KEYS.includes(key))
      problems.push({ field: key, reason: "not settable by a recipe" });
  }

  const text = (key: keyof RecipeMeta): RecipeMeta => {
    const value = read(root[key], key, Schema.String, "not a string", undefined, problems);

    return value === undefined ? {} : { [key]: value };
  };

  const meta = { ...text("name"), ...text("description") };

  return result(
    {
      ...base,
      ...recipeKeys(parseKeymapName(root.input, base.keymap.name, problems), base),
      layout: parseLayout(root.layout, base.layout, problems),
    },
    meta,
  );
}
