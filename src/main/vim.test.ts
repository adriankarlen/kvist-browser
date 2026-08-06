import { beforeEach, expect, test, vi } from "vite-plus/test";
import type { Mode } from "../shared/ipc";
import { type KeyInput, Vim } from "./vim";

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
};

let vim: Vim;
let modes: Mode[];

const key = (k: string, modifiers: Partial<KeyInput> = {}): boolean =>
  vim.handleKey({ key: k, control: false, alt: false, meta: false, ...modifiers });

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
