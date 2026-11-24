import { describe, expect, test } from "vite-plus/test";
import type { KeyToken } from "../../../shared/schema/keymap";
import { isModifierKey, type KeyInput, keyId, matchesKey, parseChord, parseKeys } from "./keybinds";

const key = (name: string, modifiers: Partial<KeyToken> = {}): KeyToken => ({
  key: name,
  control: false,
  alt: false,
  meta: false,
  shift: false,
  ...modifiers,
});

const input = (name: string, modifiers: Partial<KeyInput> = {}): KeyInput => ({
  ...key(name),
  code: "",
  ...modifiers,
});

describe("vim notation", () => {
  test("a plain character is one key, and its case is its Shift", () => {
    expect(parseKeys("gt")).toEqual([key("g"), key("t")]);
    expect(parseKeys("G")).toEqual([key("g", { shift: true })]);
    expect(parseKeys(":")).toEqual([key(":")]);
  });

  test("brackets name keys, with vim's names or the browser's", () => {
    expect(parseKeys("<Esc>")).toEqual([key("Escape")]);
    expect(parseKeys("<CR>")).toEqual([key("Enter")]);
    expect(parseKeys("<Space>")).toEqual([key(" ")]);
    expect(parseKeys("<lt>")).toEqual([key("<")]);
    expect(parseKeys("<F5>")).toEqual([key("F5")]);
    expect(parseKeys("<ArrowLeft>")).toEqual([key("ArrowLeft")]);
    expect(parseKeys("g<Tab>")).toEqual([key("g"), key("Tab")]);
  });

  test("modifiers: C is Ctrl, A and M are Alt, D is Cmd or Super, S is Shift", () => {
    expect(parseKeys("<C-d>")).toEqual([key("d", { control: true })]);
    expect(parseKeys("<A-x>")).toEqual([key("x", { alt: true })]);
    expect(parseKeys("<M-x>")).toEqual([key("x", { alt: true })]);
    expect(parseKeys("<D-x>")).toEqual([key("x", { meta: true })]);
    expect(parseKeys("<S-Tab>")).toEqual([key("Tab", { shift: true })]);
    expect(parseKeys("<C-S-Tab>")).toEqual([key("Tab", { control: true, shift: true })]);
  });

  test("a held letter ignores its case; only S- adds Shift", () => {
    expect(parseKeys("<C-D>")).toEqual(parseKeys("<C-d>"));
    expect(parseKeys("<C-S-d>")).toEqual([key("d", { control: true, shift: true })]);
  });

  test("anything that is not a key is rejected", () => {
    for (const bad of ["", "<C-", "<>", "<nope>", "<X-a>", "g<C-"]) {
      expect(parseKeys(bad)).toBeUndefined();
    }
  });
});

describe("chord notation", () => {
  test("Mod is Cmd on macOS and Ctrl elsewhere", () => {
    expect(parseChord("Mod+T", "darwin")).toEqual(key("t", { meta: true }));
    expect(parseChord("Mod+T", "linux")).toEqual(key("t", { control: true }));
  });

  test("Ctrl and Meta are the same key on every platform", () => {
    for (const platform of ["darwin", "linux"] as const) {
      expect(parseChord("Ctrl+Tab", platform)).toEqual(key("Tab", { control: true }));
      expect(parseChord("Meta+K", platform)).toEqual(key("k", { meta: true }));
    }
  });

  test("Shift is a modifier, and a trailing ++ is the plus key", () => {
    expect(parseChord("Mod+Shift+T", "linux")).toEqual(key("t", { control: true, shift: true }));
    expect(parseChord("Mod++", "linux")).toEqual(key("+", { control: true }));
    expect(parseChord("F12", "linux")).toEqual(key("F12"));
  });

  test("an unknown modifier or key is rejected", () => {
    expect(parseChord("Hyper+T", "linux")).toBeUndefined();
    expect(parseChord("Mod+Nope!", "linux")).toBeUndefined();
    expect(parseChord("Mod+", "linux")).toBeUndefined();
  });

  test("both notations spell a key the same way once read", () => {
    const vim = parseKeys("<C-d>")?.[0];
    const chord = parseChord("Ctrl+D", "linux");

    expect(vim && chord && keyId(vim)).toBe(chord && keyId(chord));
    expect(keyId(key("t", { meta: true }))).not.toBe(keyId(key("t", { control: true })));
  });
});

describe("matching", () => {
  const matches = (bound: KeyToken | undefined, pressed: KeyInput): boolean =>
    bound !== undefined && matchesKey(bound, pressed);

  test("a plain letter is the character typed", () => {
    const g = key("g", { shift: true });

    expect(matches(g, input("G", { shift: true }))).toBe(true);
    expect(matches(g, input("g"))).toBe(false);
    expect(matches(key("g"), input("G", { shift: true }))).toBe(false);
  });

  test("Escape is one key, not E followed by more", () => {
    expect(matches(parseKeys("<Esc>")?.[0], input("E", { shift: true }))).toBe(false);
    expect(matches(parseKeys("<Esc>")?.[0], input("Escape"))).toBe(true);
  });

  test("Ctrl, Alt and Meta match exactly", () => {
    const modT = parseChord("Mod+T", "linux");

    expect(matches(modT, input("t", { control: true }))).toBe(true);
    expect(matches(modT, input("t", { control: true, alt: true }))).toBe(false);
    expect(matches(modT, input("t"))).toBe(false);
    expect(matches(key("t"), input("t", { control: true }))).toBe(false);
  });

  test("Shift tells held letters apart, whatever case the key arrives in", () => {
    const reopen = parseChord("Mod+Shift+T", "linux");

    expect(matches(reopen, input("t", { control: true, shift: true }))).toBe(true);
    expect(matches(reopen, input("T", { control: true, shift: true }))).toBe(true);
    expect(matches(parseChord("Mod+T", "linux"), input("T", { control: true }))).toBe(true);
  });

  test("a printable key carries its own Shift, so = and + are told apart by key", () => {
    expect(matches(parseChord("Mod+=", "darwin"), input("=", { meta: true }))).toBe(true);
    expect(matches(parseChord("Mod++", "darwin"), input("+", { meta: true, shift: true }))).toBe(
      true,
    );
    expect(matches(key(":"), input(":", { shift: true }))).toBe(true);
  });

  test("with Alt held, a letter matches on the physical key", () => {
    const devtools = parseChord("Mod+Alt+I", "darwin");

    expect(matches(devtools, input("ˆ", { meta: true, alt: true, code: "KeyI" }))).toBe(true);
    expect(matches(devtools, input("i", { meta: true, alt: true, code: "KeyJ" }))).toBe(false);
  });

  test("a non-Latin layout falls back to the physical key, a Latin one does not", () => {
    const modT = parseChord("Mod+T", "linux");

    expect(matches(modT, input("е", { control: true, code: "KeyT" }))).toBe(true);
    // Dvorak types "y" on the physical T key, and that is Mod+Y, not Mod+T.
    expect(matches(modT, input("y", { control: true, code: "KeyT" }))).toBe(false);
    expect(matches(modT, input("t", { control: true, code: "KeyK" }))).toBe(true);
  });

  test("a named key compares Shift", () => {
    expect(matches(key("Tab", { shift: true }), input("Tab", { shift: true }))).toBe(true);
    expect(matches(key("Tab"), input("Tab", { shift: true }))).toBe(false);
  });
});

test("a modifier on its own is not a key", () => {
  expect(isModifierKey("Shift")).toBe(true);
  expect(isModifierKey("Meta")).toBe(true);
  expect(isModifierKey("s")).toBe(false);
});
