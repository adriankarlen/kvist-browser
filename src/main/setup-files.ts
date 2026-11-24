import { Schema } from "effect";
import { DEFAULT_RECIPE, DEFAULT_SETTINGS } from "../shared/config";
import { SUPPORT } from "../shared/layout";
import {
  DENSITY_SCALE,
  FIRST_RUN_RECIPE,
  type RecipeOption,
  type SetupChoices,
  type SetupOptions,
} from "../shared/setup";
import type { ParsedRecipe } from "./recipes";
import { SearchTemplate } from "./settings";

/** What the wizard writes. No `css` means config.css is left alone. */
export interface SetupFiles {
  readonly toml: string;
  readonly css: string | undefined;
}

/** A parsed recipe as the wizard offers it. */
export function recipeOption(id: string, recipe: ParsedRecipe): RecipeOption {
  return {
    id,
    name: recipe.meta.name ?? id,
    description: recipe.meta.description ?? "",
    inputMode: recipe.base.inputMode,
    omnibox: recipe.base.layout.omnibox.region,
    tabs: recipe.base.layout.tabs.region,
  };
}

/** Modern once it ships, today's look until then. */
export const firstRunRecipe = (catalog: ReadonlyArray<string>): string =>
  catalog.includes(FIRST_RUN_RECIPE) ? FIRST_RUN_RECIPE : DEFAULT_RECIPE;

export function setupOptions(
  recipes: ReadonlyArray<RecipeOption>,
  cssExists: boolean,
): SetupOptions {
  return {
    recipes,
    recipe: firstRunRecipe(recipes.map((recipe) => recipe.id)),
    omniboxRegions: SUPPORT.omnibox.regions,
    tabsRegions: SUPPORT.tabs.regions,
    densityAvailable: !cssExists,
    searchUrl: DEFAULT_SETTINGS.searchUrl,
  };
}

export const isSearchUrl = Schema.is(SearchTemplate);

/** Why choices cannot be saved, if they cannot. The view is not trusted to have checked. */
export function choicesProblem(choices: SetupChoices, options: SetupOptions): string | undefined {
  if (!options.recipes.some((recipe) => recipe.id === choices.recipe))
    return `no recipe named ${choices.recipe}`;

  if (!options.omniboxRegions.includes(choices.omnibox))
    return `the URL bar cannot go ${choices.omnibox}`;

  if (!options.tabsRegions.includes(choices.tabs)) return `tabs cannot go ${choices.tabs}`;

  if (!isSearchUrl(choices.searchUrl)) return 'the search URL needs a "{q}" placeholder';

  return undefined;
}

/** A TOML basic string. JSON's escapes are a subset of TOML's, so JSON's quoting is valid TOML. */
const tomlString = (value: string): string => JSON.stringify(value);

const TOML_HEADER =
  "# Written by the Kvist setup wizard. Edit it freely; Kvist reloads it on save.";

const CSS_HEADER =
  "/* Written by the Kvist setup wizard. Kvist never writes this file again; it is yours. */";

/**
 * config.toml says only what differs from the chosen recipe. Anything it
 * says outranks every recipe, so a choice that matches the recipe is left
 * for the recipe to decide, and a later `:recipe` can still change it.
 */
export function renderSetup(
  choices: SetupChoices,
  recipe: RecipeOption,
  cssExists: boolean,
): SetupFiles {
  const top = [TOML_HEADER, `recipe = ${tomlString(choices.recipe)}`];

  if (choices.searchUrl !== DEFAULT_SETTINGS.searchUrl)
    top.push(`search = ${tomlString(choices.searchUrl)}`);

  const tables: string[] = [];

  const table = (header: string, key: string, value: string): void => {
    tables.push("", `[${header}]`, `${key} = ${tomlString(value)}`);
  };

  if (choices.inputMode !== recipe.inputMode) table("input", "mode", choices.inputMode);

  if (choices.omnibox !== recipe.omnibox) table("layout.omnibox", "region", choices.omnibox);

  if (choices.tabs !== recipe.tabs) table("layout.tabs", "region", choices.tabs);

  const scale = DENSITY_SCALE[choices.density];

  const css =
    cssExists || choices.density === "normal"
      ? undefined
      : `${CSS_HEADER}\n:root {\n  --kv-density: ${scale};\n}\n`;

  return { toml: `${[...top, ...tables].join("\n")}\n`, css };
}
