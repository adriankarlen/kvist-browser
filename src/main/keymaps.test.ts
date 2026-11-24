import { describe, expect, test } from "vite-plus/test";
import {
  builtInKeymap,
  keymapCatalog,
  listUserKeymaps,
  parseKeymapFile,
  resolveKeymap,
} from "./keymaps";

describe("listUserKeymaps", () => {
  test("names each .toml, and reports a name that is not one", () => {
    expect(
      listUserKeymaps(["b.toml", "a.toml", "notes.txt", ".hidden.toml", "Bad Name.toml"]),
    ).toEqual({
      names: ["a", "b"],
      problems: [
        {
          file: "keymaps/Bad Name.toml",
          field: "keymaps/Bad Name.toml",
          reason: 'not a keymap name: lowercase letters, digits and "-"',
        },
      ],
    });
  });
});

describe("parseKeymapFile", () => {
  test("reads the base engine, the keys and what it calls itself", () => {
    const preset = parseKeymapFile(
      "mine",
      'format = 1\nname = "Mine"\ndescription = "d"\nbase = "standard"\n[keys.chords]\n"Ctrl+K" = "tab.next"',
    );

    expect(preset.engine).toBe("standard");
    expect(preset.meta).toEqual({ name: "Mine", description: "d" });
    expect(preset.layers).toEqual([
      { keys: { chords: { "Ctrl+K": "tab.next" } }, file: "keymaps/mine.toml" },
    ]);
    expect(preset.problems).toEqual([]);
  });

  test("no base is vim", () => {
    expect(parseKeymapFile("mine", "format = 1").engine).toBe("vim");
  });

  test("a missing or unknown format skips the keys but keeps the base", () => {
    const missing = parseKeymapFile(
      "mine",
      'base = "standard"\n[keys.chords]\n"Ctrl+K" = "tab.next"',
    );

    expect(missing.engine).toBe("standard");
    expect(missing.layers).toEqual([]);
    expect(missing.problems).toEqual([
      {
        file: "keymaps/mine.toml",
        field: "keymaps/mine.toml",
        reason: "no format; add format = 1",
      },
    ]);
    expect(parseKeymapFile("mine", "format = 2").problems.map(({ field }) => field)).toEqual([
      "format",
    ]);
  });

  test("bad values and unknown keys are the file's problems", () => {
    const preset = parseKeymapFile("mine", "format = 1\nbase = 'emacs'\nrecipe = 'tui'");

    expect(preset.engine).toBe("vim");
    expect(preset.problems.map(({ file, field }) => `${file}: ${field}`)).toEqual([
      "keymaps/mine.toml: base",
      "keymaps/mine.toml: recipe",
    ]);
  });

  test("a syntax error is the file's problem", () => {
    expect(parseKeymapFile("mine", "format = ").problems.map(({ field }) => field)).toEqual([
      "keymaps/mine.toml",
    ]);
  });
});

describe("resolveKeymap", () => {
  const mine = parseKeymapFile("mine", "format = 1");
  const shadow = parseKeymapFile("vim", 'format = 1\n[keys.normal]\n"J" = "tab.next"');

  test("finds a built-in or a user preset, and a user one shadows a built-in", () => {
    expect(resolveKeymap("standard", "vim", new Map()).preset.engine).toBe("standard");
    expect(resolveKeymap("mine", "vim", new Map([["mine", mine]])).preset).toBe(mine);
    expect(resolveKeymap("vim", "vim", new Map([["vim", shadow]])).preset).toBe(shadow);
  });

  test("an unknown name falls back to the recipe's preset, then to vim", () => {
    const toRecipe = resolveKeymap("nope", "standard", new Map());

    expect(toRecipe.preset.name).toBe("standard");
    expect(toRecipe.problems.map(({ field }) => field)).toEqual(["input.mode"]);
    expect(resolveKeymap("nope", "gone", new Map()).preset.name).toBe("vim");
  });

  test("a preset in use brings its file's problems", () => {
    const broken = parseKeymapFile("broken", "format = 2");

    expect(resolveKeymap("broken", "vim", new Map([["broken", broken]])).problems).toEqual(
      broken.problems,
    );
  });
});

test("the catalog lists each name once", () => {
  expect(keymapCatalog(["vim", "mine"])).toEqual(["mine", "standard", "vim"]);
});

test("a built-in keymap is the registry's keys for its engine", () => {
  expect(builtInKeymap("standard", "linux").bindings.every(({ table }) => table === "chords")).toBe(
    true,
  );
});
