import { beforeEach, expect, test, vi } from "vite-plus/test";
import type { Mode } from "../shared/ipc";
import { DEFAULT_KEYBINDS } from "./keybinds";
import { type KeyInput, type KeySource, Vim } from "./vim";

let execute: ReturnType<typeof vi.fn<(name: string, arg?: string) => void>>;
let vim: Vim;
let modes: Mode[];

const from =
  (source: KeySource) =>
  (k: string, modifiers: Partial<KeyInput> = {}): boolean =>
    vim.handleKey({ key: k, control: false, alt: false, meta: false, ...modifiers }, source);

const key = from("page");
const chromeKey = from("chrome");

beforeEach(() => {
  execute = vi.fn();
  modes = [];
  vim = new Vim(DEFAULT_KEYBINDS, execute, (mode) => modes.push(mode));
});

test("starts in normal mode", () => {
  expect(vim.mode).toBe("normal");
});

test("gt and gT step through tabs", () => {
  expect(key("g")).toBe(true);
  expect(key("t")).toBe(true);
  expect(execute).toHaveBeenCalledWith("tab.next");

  key("g");
  key("T");
  expect(execute).toHaveBeenCalledWith("tab.prev");
});

test("t alone opens a tab rather than continuing a g sequence", () => {
  expect(key("t")).toBe(true);
  expect(execute).toHaveBeenCalledWith("tab.new");
  expect(execute).not.toHaveBeenCalledWith("tab.next");
});

test("an unknown g sequence is swallowed, not leaked to the page", () => {
  key("g");
  expect(key("z")).toBe(true);
  expect(execute).not.toHaveBeenCalledWith("tab.next");
});

test("Escape clears a pending prefix", () => {
  key("g");
  key("Escape");
  // Escape after g is swallowed as an unknown sequence, find.clear is NOT run
  expect(execute).not.toHaveBeenCalledWith("find.clear");
  key("t");
  expect(execute).toHaveBeenCalledWith("tab.new");
  expect(execute).not.toHaveBeenCalledWith("tab.next");
});

test("unbound keys pass through to the page", () => {
  expect(key("q")).toBe(false);
});

test("modified keys always pass through so page shortcuts still work", () => {
  expect(key("t", { control: true })).toBe(false);
  expect(execute).not.toHaveBeenCalled();
});

test("insert mode passes keys through and Escape returns to normal", () => {
  key("i");
  expect(vim.mode).toBe("insert");
  // enter-only binding changes mode without dispatching a command
  expect(execute).not.toHaveBeenCalled();

  expect(key("t")).toBe(false);
  expect(execute).not.toHaveBeenCalledWith("tab.new");

  expect(key("Escape")).toBe(true);
  expect(vim.mode).toBe("normal");
  expect(execute).toHaveBeenCalledWith("insert.leave");
});

test("o focuses the omnibox and enters insert", () => {
  key("o");
  expect(execute).toHaveBeenCalledWith("focus.omnibox");
  expect(vim.mode).toBe("insert");
});

test("colon opens the command line and moves focus to the chrome", () => {
  key(":");
  expect(vim.mode).toBe("command");
  expect(execute).toHaveBeenCalledWith("focus.chrome");
});

test("command mode leaves keys to the chrome", () => {
  key(":");
  expect(key("t")).toBe(false);
  expect(execute).not.toHaveBeenCalledWith("tab.new");
});

test("returning to normal from the chrome refocuses the page", () => {
  key(":");
  vim.requestMode("normal");
  expect(vim.mode).toBe("normal");
  expect(execute).toHaveBeenCalledWith("focus.page");
});

test("mode changes are broadcast once each", () => {
  key("i");
  key("Escape");
  expect(modes).toEqual(["insert", "normal"]);
});

test("navigation keys are bound", () => {
  key("H");
  key("L");
  key("r");
  key("x");
  expect(execute).toHaveBeenCalledWith("nav.back");
  expect(execute).toHaveBeenCalledWith("nav.forward");
  expect(execute).toHaveBeenCalledWith("nav.reload");
  expect(execute).toHaveBeenCalledWith("tab.close");
});

test("zoom keys are bound in normal mode only", () => {
  key("zi");
  key("zo");
  key("z0");
  expect(execute.mock.calls).toEqual([["zoom.in"], ["zoom.out"], ["zoom.reset"]]);
});

test("z alone is a prefix and does not execute", () => {
  expect(key("z")).toBe(true);
  expect(execute).not.toHaveBeenCalled();
});

test("z in insert mode is not a binding", () => {
  key("i");
  expect(key("z")).toBe(false);
  expect(key("z"));
  expect(key("i")).toBe(false);
  expect(execute).not.toHaveBeenCalledWith("zoom.in");
});

test("chrome keys drive normal mode, so focus on the chrome is not a dead end", () => {
  expect(chromeKey("t")).toBe(true);
  expect(execute).toHaveBeenCalledWith("tab.new");
});

test("chrome prefixes work across sources", () => {
  chromeKey("g");
  expect(chromeKey("t")).toBe(true);
  expect(execute).toHaveBeenCalledWith("tab.next");
});

test("insert mode lets the chrome type, including its own Escape", () => {
  key("i");
  expect(chromeKey("t")).toBe(false);
  expect(chromeKey("Escape")).toBe(false);
  expect(vim.mode).toBe("insert");
  expect(execute).not.toHaveBeenCalledWith("tab.new");
});

test("command mode lets the command line type", () => {
  key(":");
  expect(chromeKey("q")).toBe(false);
  expect(chromeKey("Escape")).toBe(false);
  expect(execute).not.toHaveBeenCalledWith("tab.close");
});

test("modified chrome keys pass through", () => {
  expect(chromeKey("t", { meta: true })).toBe(false);
  expect(execute).not.toHaveBeenCalled();
});

test("focusing a text field on the page enters insert", () => {
  vim.setEditable(true);
  expect(vim.mode).toBe("insert");
  expect(key("t")).toBe(false);
  expect(execute).not.toHaveBeenCalledWith("tab.new");
});

test("leaving a text field returns to normal", () => {
  vim.setEditable(true);
  vim.setEditable(false);
  expect(vim.mode).toBe("normal");
  expect(modes).toEqual(["insert", "normal"]);
});

test("a page text field does not steal the command line", () => {
  key(":");
  vim.setEditable(true);
  expect(vim.mode).toBe("command");
});

test("Escape blurs the field, so normal mode actually gets the keyboard back", () => {
  vim.setEditable(true);
  expect(key("Escape")).toBe(true);
  expect(execute).toHaveBeenCalledWith("insert.leave");
  expect(vim.mode).toBe("normal");
});

test("a field losing focus while already normal changes nothing", () => {
  vim.setEditable(false);
  expect(vim.mode).toBe("normal");
  expect(modes).toEqual([]);
});

test("scroll keys drive the page", () => {
  expect(key("j")).toBe(true);
  expect(key("k")).toBe(true);
  expect(key("d")).toBe(true);
  expect(key("u")).toBe(true);
  expect(key("G")).toBe(true);
  expect(execute.mock.calls).toEqual([
    ["scroll.down"],
    ["scroll.up"],
    ["scroll.half-down"],
    ["scroll.half-up"],
    ["scroll.bottom"],
  ]);
});

test("gg scrolls to the top", () => {
  key("g");
  expect(key("g")).toBe(true);
  expect(execute).toHaveBeenCalledWith("scroll.top");
});

test("scroll keys stay out of a text field", () => {
  vim.setEditable(true);
  expect(key("j")).toBe(false);
  expect(execute).not.toHaveBeenCalledWith("scroll.down");
});

test("f shows hints and enters hint mode", () => {
  expect(key("f")).toBe(true);
  expect(execute).toHaveBeenCalledWith("hints.show");
  expect(vim.mode).toBe("hint");
});

test("hint mode forwards every key to the page", () => {
  key("f");
  execute.mockClear();

  expect(key("a")).toBe(true);
  expect(key("t")).toBe(true);
  expect(execute.mock.calls).toEqual([
    ["hints.key", "a"],
    ["hints.key", "t"],
  ]);
  // t must not have opened a tab on the way past.
  expect(execute).not.toHaveBeenCalledWith("tab.new");
});

test("hint mode swallows chrome keys too", () => {
  key("f");
  execute.mockClear();

  expect(chromeKey("a")).toBe(true);
  expect(execute).toHaveBeenCalledWith("hints.key", "a");
});

test("Escape leaves hint mode and clears the labels", () => {
  key("f");
  expect(key("Escape")).toBe(true);
  expect(execute).toHaveBeenCalledWith("hints.hide");
  expect(vim.mode).toBe("normal");
});

test("the page reporting hints finished returns to normal", () => {
  key("f");
  vim.endHints();
  expect(vim.mode).toBe("normal");
});

test("slash opens the find prompt and moves focus to the chrome", () => {
  key("/");
  expect(vim.mode).toBe("find");
  expect(execute).toHaveBeenCalledWith("focus.chrome");
});

test("find mode leaves keys to the prompt, from either source", () => {
  key("/");
  expect(key("t")).toBe(false);
  expect(chromeKey("t")).toBe(false);
  expect(chromeKey("Escape")).toBe(false);
  expect(execute).not.toHaveBeenCalledWith("tab.new");
});

test("a page text field does not steal the find prompt", () => {
  key("/");
  vim.setEditable(true);
  expect(vim.mode).toBe("find");
});

test("n and N cycle matches once the prompt is gone", () => {
  key("/");
  vim.requestMode("normal");
  execute.mockClear();

  expect(key("n")).toBe(true);
  expect(key("N")).toBe(true);
  expect(execute.mock.calls).toEqual([["find.next"], ["find.prev"]]);
});

test("Escape in normal mode clears the match highlighting", () => {
  key("Escape");
  expect(execute).toHaveBeenCalledWith("find.clear");
});

test("selecting a field keeps insert rather than snapping back to normal", () => {
  key("f");
  // Focus lands on the hinted input before the page reports hinting is over.
  vim.setEditable(true);
  vim.endHints();
  expect(vim.mode).toBe("insert");
});

test("a pending permission question captures normal mode", () => {
  vim.setPromptPending(true);
  expect(vim.mode).toBe("prompt");
  expect(modes).toEqual(["prompt"]);
});

test("y, n and Escape answer the question", () => {
  vim.setPromptPending(true);

  expect(key("y")).toBe(true);
  expect(execute).toHaveBeenCalledWith("prompt.allow");

  expect(key("n")).toBe(true);
  expect(execute).toHaveBeenCalledWith("prompt.deny");

  expect(key("Escape")).toBe(true);
  expect(execute).toHaveBeenCalledWith("prompt.deny");
  // No command runs focus.page or the like: the mode outlives one answer
  // while the queue has another question behind it.
  expect(vim.mode).toBe("prompt");
});

test("prompt mode swallows every other key, from either source", () => {
  vim.setPromptPending(true);

  expect(key("j")).toBe(true);
  expect(chromeKey("t")).toBe(true);
  expect(execute).not.toHaveBeenCalledWith("scroll.down");
  expect(execute).not.toHaveBeenCalledWith("tab.new");
});

test("the queue draining is what hands normal back", () => {
  vim.setPromptPending(true);
  // Answered, but another question is queued behind it: still prompting.
  vim.setPromptPending(true);
  expect(vim.mode).toBe("prompt");

  vim.setPromptPending(false);
  expect(vim.mode).toBe("normal");
  expect(modes).toEqual(["prompt", "normal"]);
});

test("a question arriving mid-typing waits, and catches the way back through normal", () => {
  key("i");
  expect(vim.mode).toBe("insert");

  vim.setPromptPending(true);
  expect(vim.mode).toBe("insert");

  // Leaving insert heads for normal, and the pending question intercepts it.
  key("Escape");
  expect(vim.mode).toBe("prompt");
});

test("a question arriving at the command line does not take its keys", () => {
  key(":");
  vim.setPromptPending(true);
  expect(vim.mode).toBe("command");
  expect(chromeKey("y")).toBe(false);
  expect(execute).not.toHaveBeenCalledWith("prompt.allow");

  // Escaping the command line lands on the prompt, not on normal.
  vim.requestMode("normal");
  expect(vim.mode).toBe("prompt");
});

test("a page text field does not steal the permission prompt", () => {
  vim.setPromptPending(true);
  vim.setEditable(true);
  expect(vim.mode).toBe("prompt");
});
