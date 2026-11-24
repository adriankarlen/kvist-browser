import { describe, expect, test } from "vite-plus/test";
import { type ChordInput, findChord, standardKeybinds } from "./keybinds";

const mac = standardKeybinds("darwin");
const linux = standardKeybinds("linux");

const input = (key: string, modifiers: Partial<ChordInput> = {}): ChordInput => ({
  key,
  code: "",
  control: false,
  alt: false,
  meta: false,
  shift: false,
  ...modifiers,
});

const commandOf = (
  chords: typeof mac,
  key: string,
  modifiers: Partial<ChordInput> = {},
): string | undefined => {
  const found = findChord(chords, input(key, modifiers));

  return found && (found.arg === undefined ? found.command : `${found.command} ${found.arg}`);
};

describe("Mod", () => {
  test("is Cmd on macOS", () => {
    expect(commandOf(mac, "t", { meta: true })).toBe("tab.new");
    expect(commandOf(mac, "t", { control: true })).toBeUndefined();
  });

  test("is Ctrl elsewhere", () => {
    expect(commandOf(linux, "t", { control: true })).toBe("tab.new");
    expect(commandOf(linux, "t", { meta: true })).toBeUndefined();
  });
});

test("Ctrl+Tab is Ctrl on every platform", () => {
  for (const chords of [mac, linux]) {
    expect(commandOf(chords, "Tab", { control: true })).toBe("tab.next");
    expect(commandOf(chords, "Tab", { control: true, shift: true })).toBe("tab.prev");
  }
});

test("modifiers match exactly", () => {
  expect(commandOf(linux, "t", { control: true, alt: true })).toBeUndefined();
  expect(commandOf(linux, "t")).toBeUndefined();
  expect(commandOf(linux, "F5")).toBe("nav.reload");
  expect(commandOf(linux, "F5", { control: true })).toBeUndefined();
});

test("Shift tells letters apart, whatever case the key arrives in", () => {
  expect(commandOf(linux, "t", { control: true, shift: true })).toBe("tab.reopen");
  expect(commandOf(linux, "T", { control: true, shift: true })).toBe("tab.reopen");
  expect(commandOf(linux, "T", { control: true })).toBe("tab.new");
  expect(commandOf(mac, "G", { meta: true, shift: true })).toBe("find.prev");
});

test("a printable key carries its own Shift, so = and + both zoom in", () => {
  expect(commandOf(mac, "=", { meta: true })).toBe("zoom.in");
  expect(commandOf(mac, "+", { meta: true, shift: true })).toBe("zoom.in");
  expect(commandOf(linux, "-", { control: true })).toBe("zoom.out");
  expect(commandOf(linux, "0", { control: true })).toBe("zoom.reset");
});

test("with Alt held, a letter matches on the physical key", () => {
  expect(commandOf(mac, "ˆ", { meta: true, alt: true, code: "KeyI" })).toBe("app.devtools");
  expect(commandOf(linux, "i", { control: true, alt: true, code: "KeyI" })).toBe("app.devtools");
  expect(commandOf(linux, "i", { control: true, alt: true, code: "KeyJ" })).toBeUndefined();
});

test("Mod+digit selects a tab by position, and 9 is the last tab", () => {
  expect(commandOf(mac, "1", { meta: true })).toBe("tab.select 1");
  expect(commandOf(linux, "8", { control: true })).toBe("tab.select 8");
  expect(commandOf(linux, "9", { control: true })).toBe("tab.select last");
});

test("Alt+arrows go back and forward, except on macOS where they move by word", () => {
  expect(commandOf(linux, "ArrowLeft", { alt: true })).toBe("nav.back");
  expect(commandOf(linux, "ArrowRight", { alt: true })).toBe("nav.forward");
  expect(commandOf(mac, "ArrowLeft", { alt: true })).toBeUndefined();
  expect(commandOf(mac, "[", { meta: true })).toBe("nav.back");
});

test("clipboard and editing chords are left to the edit menu", () => {
  for (const key of ["c", "v", "x", "z", "a"]) {
    expect(commandOf(mac, key, { meta: true })).toBeUndefined();
    expect(commandOf(linux, key, { control: true })).toBeUndefined();
  }
});

test("chords that open something to type into say which mode", () => {
  const enters = (key: string, shift = false) =>
    findChord(linux, input(key, { control: true, shift }))?.enter;

  expect(enters("l")).toBe("insert");
  expect(enters("f")).toBe("find");
  expect(enters("p", true)).toBe("command");
  expect(enters("o", true)).toBe("insert");
});
