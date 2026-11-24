import { describe, expect, test } from "vite-plus/test";
import { DEFAULT_SETTINGS } from "../shared/config";
import { DENSITIES, SEARCH_ENGINES, type SetupChoices } from "../shared/setup";
import { parseRecipe } from "./recipes";
import { parseSettings, readRecipeName } from "./settings";
import {
  choicesProblem,
  firstRunRecipe,
  recipeOption,
  renderSetup,
  setupOptions,
} from "./setup-files";

const TEST_RECIPE = `format = 1
name = "Test"
description = "Standard keys, tabs on the left."

[input]
mode = "standard"

[layout.tabs]
region = "left"
`;

const recipes = {
  tui: parseRecipe("tui", undefined),
  test: parseRecipe("test", TEST_RECIPE),
};

const options = setupOptions(
  Object.entries(recipes).map(([id, recipe]) => recipeOption(id, recipe)),
  false,
);

const optionFor = (id: string) => options.recipes.find((recipe) => recipe.id === id)!;

const defaultsFor = (id: keyof typeof recipes): SetupChoices => ({
  recipe: id,
  inputMode: optionFor(id).inputMode,
  omnibox: optionFor(id).omnibox,
  tabs: optionFor(id).tabs,
  density: "normal",
  searchUrl: DEFAULT_SETTINGS.searchUrl,
});

/** Reads the written TOML the way startup will: the recipe name first, then over its base. */
function reload(toml: string, id: keyof typeof recipes) {
  const name = readRecipeName(toml, "tui");
  const parsed = parseSettings(toml, recipes[id].base, recipes[id].base);

  return {
    name: name.name,
    settings: parsed.settings,
    problems: [...name.problems, ...parsed.problems],
  };
}

describe("recipeOption", () => {
  test("names a recipe by its meta, and reads its defaults", () => {
    expect(optionFor("test")).toEqual({
      id: "test",
      name: "Test",
      description: "Standard keys, tabs on the left.",
      inputMode: "standard",
      omnibox: "top",
      tabs: "left",
    });
    expect(optionFor("tui").name).toBe("tui");
  });
});

describe("firstRunRecipe", () => {
  test("is modern once it exists, and tui until then", () => {
    expect(firstRunRecipe(["tui"])).toBe("tui");
    expect(firstRunRecipe(["modern", "tui"])).toBe("modern");
  });
});

describe("renderSetup", () => {
  test("a recipe as it comes writes the recipe line and nothing else", () => {
    const files = renderSetup(defaultsFor("test"), optionFor("test"), false);

    expect(files.toml).toBe(
      '# Written by the Kvist setup wizard. Edit it freely; Kvist reloads it on save.\nrecipe = "test"\n',
    );
    expect(files.css).toBeUndefined();
  });

  test("writes only the choices that differ from the recipe", () => {
    const files = renderSetup(
      { ...defaultsFor("test"), omnibox: "floating" },
      optionFor("test"),
      false,
    );

    expect(files.toml).toContain('[layout.omnibox]\nregion = "floating"');
    expect(files.toml).not.toContain("[input]");
    expect(files.toml).not.toContain("[layout.tabs]");
  });

  test("every combination reads back as exactly the choices, with no problems", () => {
    for (const id of ["tui", "test"] as const) {
      for (const inputMode of ["vim", "standard"] as const) {
        for (const omnibox of options.omniboxRegions) {
          for (const tabs of options.tabsRegions) {
            for (const { url: searchUrl } of SEARCH_ENGINES) {
              const choices = { ...defaultsFor(id), inputMode, omnibox, tabs, searchUrl };
              const back = reload(renderSetup(choices, optionFor(id), false).toml, id);

              expect(back.problems).toEqual([]);
              expect(back.name).toBe(id);
              expect(back.settings.inputMode).toBe(inputMode);
              expect(back.settings.layout.omnibox.region).toBe(omnibox);
              expect(back.settings.layout.tabs.region).toBe(tabs);
              expect(back.settings.searchUrl).toBe(searchUrl);
            }
          }
        }
      }
    }
  });

  test("a custom search URL with quotes and backslashes survives the trip", () => {
    const searchUrl = 'https://example.com/s?q={q}&x="a\\b"';
    const files = renderSetup({ ...defaultsFor("tui"), searchUrl }, optionFor("tui"), false);

    expect(reload(files.toml, "tui").settings.searchUrl).toBe(searchUrl);
  });

  test("a custom search URL with DEL and other control characters still parses", () => {
    const searchUrl = "https://example.com/s?q={q}&x=\u007f\u0001\t";
    const files = renderSetup({ ...defaultsFor("tui"), searchUrl }, optionFor("tui"), false);
    const back = reload(files.toml, "tui");

    expect(back.problems).toEqual([]);
    expect(back.settings.searchUrl).toBe(searchUrl);
  });

  test("density writes config.css, except for normal or when config.css exists", () => {
    for (const density of DENSITIES) {
      const css = renderSetup({ ...defaultsFor("tui"), density }, optionFor("tui"), false).css;

      expect(css === undefined).toBe(density === "normal");
    }

    const compact = { ...defaultsFor("tui"), density: "compact" as const };

    expect(renderSetup(compact, optionFor("tui"), false).css).toContain("--kv-density: 0.85;");
    expect(renderSetup(compact, optionFor("tui"), true).css).toBeUndefined();
  });
});

describe("choicesProblem", () => {
  test("accepts the defaults", () => {
    expect(choicesProblem(defaultsFor("tui"), options)).toBeUndefined();
  });

  test("refuses what the view should not have sent", () => {
    const base = defaultsFor("tui");

    expect(choicesProblem({ ...base, recipe: "nope" }, options)).toMatch(/no recipe/);
    expect(choicesProblem({ ...base, omnibox: "left" }, options)).toMatch(/URL bar/);
    expect(choicesProblem({ ...base, tabs: "floating" }, options)).toMatch(/tabs/);
    expect(choicesProblem({ ...base, searchUrl: "https://x" }, options)).toMatch(/\{q\}/);
  });
});
