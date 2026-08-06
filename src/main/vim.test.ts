import { beforeEach, expect, test, vi } from "vite-plus/test";
import type { Mode } from "../shared/ipc";
import { type KeyInput, type KeySource, Vim } from "./vim";

const actions = {
  newTab: vi.fn(),
  closeTab: vi.fn(),
  nextTab: vi.fn(),
  prevTab: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  reload: vi.fn(),
  focusPage: vi.fn(),
  focusChrome: vi.fn(),
  focusOmnibox: vi.fn(),
  blurPage: vi.fn(),
  scrollPage: vi.fn(),
  showHints: vi.fn(),
  hideHints: vi.fn(),
  hintKey: vi.fn(),
};

let vim: Vim;
let modes: Mode[];

const from =
  (source: KeySource) =>
  (k: string, modifiers: Partial<KeyInput> = {}): boolean =>
    vim.handleKey({ key: k, control: false, alt: false, meta: false, ...modifiers }, source);

const key = from("page");
const chromeKey = from("chrome");

beforeEach(() => {
  vi.clearAllMocks();
  modes = [];
  vim = new Vim(actions, (mode) => modes.push(mode));
});

test("starts in normal mode", () => {
  expect(vim.mode).toBe("normal");
});

test("gt and gT step through tabs", () => {
  expect(key("g")).toBe(true);
  expect(key("t")).toBe(true);
  expect(actions.nextTab).toHaveBeenCalledOnce();

  key("g");
  key("T");
  expect(actions.prevTab).toHaveBeenCalledOnce();
});

test("t alone opens a tab rather than continuing a g sequence", () => {
  expect(key("t")).toBe(true);
  expect(actions.newTab).toHaveBeenCalledOnce();
  expect(actions.nextTab).not.toHaveBeenCalled();
});

test("an unknown g sequence is swallowed, not leaked to the page", () => {
  key("g");
  expect(key("z")).toBe(true);
  expect(actions.nextTab).not.toHaveBeenCalled();
});

test("Escape clears a pending prefix", () => {
  key("g");
  key("Escape");
  key("t");
  expect(actions.newTab).toHaveBeenCalledOnce();
  expect(actions.nextTab).not.toHaveBeenCalled();
});

test("unbound keys pass through to the page", () => {
  expect(key("q")).toBe(false);
});

test("modified keys always pass through so page shortcuts still work", () => {
  expect(key("t", { control: true })).toBe(false);
  expect(actions.newTab).not.toHaveBeenCalled();
});

test("insert mode passes keys through and Escape returns to normal", () => {
  key("i");
  expect(vim.mode).toBe("insert");

  expect(key("t")).toBe(false);
  expect(actions.newTab).not.toHaveBeenCalled();

  expect(key("Escape")).toBe(true);
  expect(vim.mode).toBe("normal");
  expect(actions.focusPage).toHaveBeenCalledOnce();
});

test("o focuses the omnibox and enters insert", () => {
  key("o");
  expect(actions.focusOmnibox).toHaveBeenCalledOnce();
  expect(vim.mode).toBe("insert");
});

test("colon opens the command line and moves focus to the chrome", () => {
  key(":");
  expect(vim.mode).toBe("command");
  expect(actions.focusChrome).toHaveBeenCalledOnce();
});

test("command mode leaves keys to the chrome", () => {
  key(":");
  expect(key("t")).toBe(false);
  expect(actions.newTab).not.toHaveBeenCalled();
});

test("returning to normal from the chrome refocuses the page", () => {
  key(":");
  vim.requestMode("normal");
  expect(vim.mode).toBe("normal");
  expect(actions.focusPage).toHaveBeenCalledOnce();
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
  expect(actions.back).toHaveBeenCalledOnce();
  expect(actions.forward).toHaveBeenCalledOnce();
  expect(actions.reload).toHaveBeenCalledOnce();
  expect(actions.closeTab).toHaveBeenCalledOnce();
});

test("chrome keys drive normal mode, so focus on the chrome is not a dead end", () => {
  expect(chromeKey("t")).toBe(true);
  expect(actions.newTab).toHaveBeenCalledOnce();
});

test("chrome prefixes work across sources", () => {
  chromeKey("g");
  expect(chromeKey("t")).toBe(true);
  expect(actions.nextTab).toHaveBeenCalledOnce();
});

test("insert mode lets the chrome type, including its own Escape", () => {
  key("i");
  expect(chromeKey("t")).toBe(false);
  expect(chromeKey("Escape")).toBe(false);
  expect(vim.mode).toBe("insert");
  expect(actions.newTab).not.toHaveBeenCalled();
});

test("command mode lets the command line type", () => {
  key(":");
  expect(chromeKey("q")).toBe(false);
  expect(chromeKey("Escape")).toBe(false);
  expect(actions.closeTab).not.toHaveBeenCalled();
});

test("modified chrome keys pass through", () => {
  expect(chromeKey("t", { meta: true })).toBe(false);
  expect(actions.newTab).not.toHaveBeenCalled();
});

test("focusing a text field on the page enters insert", () => {
  vim.setEditable(true);
  expect(vim.mode).toBe("insert");
  expect(key("t")).toBe(false);
  expect(actions.newTab).not.toHaveBeenCalled();
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
  expect(actions.blurPage).toHaveBeenCalledOnce();
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
  expect(actions.scrollPage.mock.calls.flat()).toEqual([
    "down",
    "up",
    "half-down",
    "half-up",
    "bottom",
  ]);
});

test("gg scrolls to the top", () => {
  key("g");
  expect(key("g")).toBe(true);
  expect(actions.scrollPage).toHaveBeenCalledWith("top");
});

test("scroll keys stay out of a text field", () => {
  vim.setEditable(true);
  expect(key("j")).toBe(false);
  expect(actions.scrollPage).not.toHaveBeenCalled();
});

test("f shows hints and enters hint mode", () => {
  expect(key("f")).toBe(true);
  expect(actions.showHints).toHaveBeenCalledOnce();
  expect(vim.mode).toBe("hint");
});

test("hint mode forwards every key to the page", () => {
  key("f");
  expect(key("a")).toBe(true);
  expect(key("t")).toBe(true);
  expect(actions.hintKey.mock.calls.flat()).toEqual(["a", "t"]);
  // t must not have opened a tab on the way past.
  expect(actions.newTab).not.toHaveBeenCalled();
});

test("hint mode swallows chrome keys too", () => {
  key("f");
  expect(chromeKey("a")).toBe(true);
  expect(actions.hintKey).toHaveBeenCalledWith("a");
});

test("Escape leaves hint mode and clears the labels", () => {
  key("f");
  expect(key("Escape")).toBe(true);
  expect(actions.hideHints).toHaveBeenCalledOnce();
  expect(vim.mode).toBe("normal");
});

test("the page reporting hints finished returns to normal", () => {
  key("f");
  vim.endHints();
  expect(vim.mode).toBe("normal");
});

test("selecting a field keeps insert rather than snapping back to normal", () => {
  key("f");
  // Focus lands on the hinted input before the page reports hinting is over.
  vim.setEditable(true);
  vim.endHints();
  expect(vim.mode).toBe("insert");
});
