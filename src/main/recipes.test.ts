import { describe, expect, test } from "vite-plus/test";
import { DEFAULT_LAYOUT } from "../shared/layout";
import { BUILT_IN, listUserRecipes, parseRecipe, recipeCatalog, resolveRecipe } from "./recipes";
import { builtInKeymap } from "./keymaps";
import { BASE_SETTINGS as DEFAULT_SETTINGS } from "./settings";

const fieldsOf = (toml: string): string[] =>
  parseRecipe("x", toml).problems.map(({ field }) => field);

test("tui ships with the app", () => {
  expect(BUILT_IN.has("tui")).toBe(true);
});

describe("the built-in tui recipe", () => {
  const { base, meta, problems } = parseRecipe("tui", BUILT_IN.get("tui")?.toml);

  test("parses cleanly, and names itself", () => {
    expect(problems).toEqual([]);
    expect(meta).toEqual({
      name: "TUI",
      description: "TUI look: monospace, framed panels, vim keys.",
    });
  });

  test("keeps today's vim keys", () => {
    expect(base.inputMode).toBe("vim");
    expect(base.keymap).toEqual(builtInKeymap("vim"));
  });

  test("keeps today's layout", () => {
    const regions = Object.fromEntries(
      Object.entries(base.layout).map(([id, placement]) => [id, placement.region]),
    );

    expect(regions).toEqual({
      tabs: "top",
      omnibox: "top",
      bookmarks: "bottom",
      downloads: "bottom",
      status: "bottom",
      find: "bottom",
      completion: "overlay",
    });
  });
});

describe("parseRecipe", () => {
  test("a recipe with no TOML is the defaults, under its own name", () => {
    expect(parseRecipe("plain", undefined)).toEqual({
      base: { ...DEFAULT_SETTINGS, recipe: "plain" },
      meta: {},
      problems: [],
    });
  });

  test("sets input and layout defaults, and names itself", () => {
    const { base, meta, problems } = parseRecipe(
      "modern",
      `
        format = 1
        name = "Modern"
        description = "Tabs on top."

        [input]
        mode = "standard"

        [layout.tabs]
        region = "top"
      `,
    );

    expect(problems).toEqual([]);
    expect(meta).toEqual({ name: "Modern", description: "Tabs on top." });
    expect(base.inputMode).toBe("standard");
    expect(base.layout.tabs).toEqual({ ...DEFAULT_LAYOUT.tabs, region: "top" });
    expect(base.homepage).toBe(DEFAULT_SETTINGS.homepage);
  });

  test("a missing or unknown format skips the file, and says which file", () => {
    const missing = parseRecipe("x", "[input]\nmode = 'standard'");

    expect(missing.base.inputMode).toBe("vim");
    expect(missing.problems).toEqual([
      { file: "recipes/x.toml", field: "recipes/x.toml", reason: "no format; add format = 1" },
    ]);

    const future = parseRecipe("x", "format = 2\n[input]\nmode = 'standard'");

    expect(future.base.inputMode).toBe("vim");
    expect(future.problems.map(({ field }) => field)).toEqual(["format"]);
  });

  test("a recipe cannot set what only config.toml may", () => {
    expect(fieldsOf("format = 1\nhomepage = 'https://x'\n[downloads]\ndir = '/'")).toEqual([
      "homepage",
      "downloads",
    ]);
    expect(parseRecipe("x", "format = 1\nhomepage = 'https://x'").base.homepage).toBe(
      DEFAULT_SETTINGS.homepage,
    );
  });

  test("bad values are reported and default, and the rest still applies", () => {
    const { base, problems } = parseRecipe(
      "x",
      "format = 1\nname = 3\n[input]\nmode = 3\n[layout.tabs]\nregion = 'left'",
    );

    expect(problems.map(({ field }) => field)).toEqual(["name", "input.mode"]);
    expect(base.layout.tabs.region).toBe("left");
  });

  test("a built-in keymap brings its keys; a user one is resolved with config.toml", () => {
    const standard = parseRecipe("x", "format = 1\n[input]\nmode = 'standard'").base;

    expect(standard.keymap.name).toBe("standard");
    expect(standard.keymap.bindings.every(({ table }) => table === "chords")).toBe(true);

    const user = parseRecipe("x", "format = 1\n[input]\nmode = 'colemak'").base;

    expect(user.keymap.name).toBe("colemak");
    expect(user.inputMode).toBe("vim");
  });

  test("a syntax error is the file's problem", () => {
    expect(fieldsOf("format = ")).toEqual(["recipes/x.toml"]);
  });
});

describe("listUserRecipes", () => {
  test("a recipe is a .css with a usable name; other files are not recipes", () => {
    expect(listUserRecipes(["b.css", "a.css", "a.toml", "notes.txt", ".hidden.css"])).toEqual({
      names: ["a", "b"],
      problems: [],
    });
  });

  test("a .toml with no .css beside it is reported", () => {
    expect(listUserRecipes(["lonely.toml"]).problems).toEqual([
      {
        file: "recipes/lonely.toml",
        field: "recipes/lonely.toml",
        reason: "no recipes/lonely.css beside it; ignored",
      },
    ]);
  });

  test("a name that could not be picked is reported, not listed", () => {
    const { names, problems } = listUserRecipes(["My Theme.css", "Neo.css"]);

    expect(names).toEqual([]);
    expect(problems.map(({ field }) => field)).toEqual(["recipes/My Theme.css", "recipes/Neo.css"]);
  });
});

describe("resolveRecipe", () => {
  test("a user recipe shadows a built-in one", () => {
    expect(resolveRecipe("tui", ["tui"]).origin).toBe("user");
    expect(resolveRecipe("tui", []).origin).toBe("builtin");
    expect(resolveRecipe("mine", ["mine"])).toEqual({ name: "mine", origin: "user", problems: [] });
  });

  test("an unknown name falls back to tui, and lists what exists", () => {
    expect(resolveRecipe("nope", ["mine"])).toEqual({
      name: "tui",
      origin: "builtin",
      problems: [{ field: "recipe", reason: 'no recipe named "nope"; available: "mine", "tui"' }],
    });
  });

  test("the catalog names each recipe once", () => {
    expect(recipeCatalog(["tui", "a"])).toEqual(["a", "tui"]);
  });
});
