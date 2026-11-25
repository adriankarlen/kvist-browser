import { expect, test } from "vite-plus/test";
import type { Binding, Keymap } from "./schema/keymap";
import { keyTitle } from "./key-title";

const bound = (table: Binding["table"], notation: string, command: string): Binding => ({
  table,
  keys: [],
  notation,
  command,
});

const vim: Keymap = {
  name: "vim",
  bindings: [
    bound("normal", "zi", "zoom.in"),
    bound("normal", "zo", "zoom.out"),
    bound("normal", "B", "bookmark.toggle"),
    bound("normal", "b", "bookmark.toggle"),
  ],
};

const standard: Keymap = {
  name: "standard",
  bindings: [bound("chords", "Mod+D", "bookmark.toggle")],
};

test("names the first key bound to each command", () => {
  expect(keyTitle("Bookmark", vim, ["bookmark.toggle"], "Cmd")).toBe("Bookmark (B)");
  expect(keyTitle("zoom", vim, ["zoom.in", "zoom.out"], "Cmd")).toBe("zoom (zi / zo)");
});

test("Mod in a chord reads as the platform's modifier", () => {
  expect(keyTitle("Bookmark", standard, ["bookmark.toggle"], "Ctrl")).toBe("Bookmark (Ctrl+D)");
});

test("a key that passes an argument does something else, so it is not named", () => {
  const keymap: Keymap = {
    name: "vim",
    bindings: [{ ...bound("normal", "T", "tab.new"), arg: "x" }],
  };

  expect(keyTitle("New tab", keymap, ["tab.new"], "Cmd")).toBe("New tab");
});

test("an unbound command is left out, and so are the brackets when nothing is bound", () => {
  expect(keyTitle("zoom", vim, ["zoom.in", "zoom.reset"], "Cmd")).toBe("zoom (zi)");
  expect(keyTitle("Reload", vim, ["nav.reload"], "Cmd")).toBe("Reload");
});
