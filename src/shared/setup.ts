import type { Density, RecipeOption, SetupChoices, SetupOptions } from "./schema/setup";

export type { Density, RecipeOption, SetupChoices, SetupOptions } from "./schema/setup";

/** What a first run gets when the user skips the wizard. The loader's own default is older. */
export const FIRST_RUN_RECIPE = "modern";

export interface SearchEngine {
  readonly name: string;
  readonly url: string;
}

/** The engines the wizard offers. The first is Kvist's default. */
export const SEARCH_ENGINES: ReadonlyArray<SearchEngine> = [
  { name: "DuckDuckGo", url: "https://duckduckgo.com/?q={q}" },
  { name: "Google", url: "https://www.google.com/search?q={q}" },
  { name: "Bing", url: "https://www.bing.com/search?q={q}" },
  { name: "Brave Search", url: "https://search.brave.com/search?q={q}" },
  { name: "Kagi", url: "https://kagi.com/search?q={q}" },
  { name: "Startpage", url: "https://www.startpage.com/do/search?q={q}" },
  { name: "Ecosia", url: "https://www.ecosia.org/search?q={q}" },
];

export const DENSITIES: ReadonlyArray<Density> = ["compact", "normal", "comfortable"];

/** `--kv-density` for each choice. `normal` is the token's own default, so it writes nothing. */
export const DENSITY_SCALE: Readonly<Record<Density, number>> = {
  compact: 0.85,
  normal: 1,
  comfortable: 1.2,
};

/** A recipe's own settings as wizard choices. Density and search are not the recipe's to set. */
export const choicesFor = (
  recipe: RecipeOption,
  { density, searchUrl }: Pick<SetupChoices, "density" | "searchUrl">,
): SetupChoices => ({
  recipe: recipe.id,
  inputMode: recipe.inputMode,
  omnibox: recipe.omnibox,
  tabs: recipe.tabs,
  density,
  searchUrl,
});

/** Where the wizard starts: the first-run recipe as it comes. */
export function initialChoices(options: SetupOptions): SetupChoices | undefined {
  const recipe = options.recipes.find((option) => option.id === options.recipe);

  return recipe && choicesFor(recipe, { density: "normal", searchUrl: options.searchUrl });
}
