import type { BrowserWindow } from "electron";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { wire } from "../shared/ipc";
import { DEFAULT_SEARCH_URL } from "../shared/url";
import { createActions } from "./actions";
import { createCommands } from "./commands";
import type { Downloads } from "./downloads";
import type { Messages } from "./messages";
import type { Permissions } from "./permissions";
import type { TabManager } from "./tab-manager";

// A spy left in place would silence the next test's console; a failed
// assertion must not be able to leave one behind.
afterEach(() => vi.restoreAllMocks());

/**
 * The clipboard an action reaches for, recorded. Both halves are spelled
 * out so each test can pin down what was read and what was written.
 */
function createClipboardStub(readText = "https://clipboard.example") {
  return {
    read: vi.fn<() => string>(() => readText),
    write: vi.fn<(text: string) => void>(),
  };
}

/**
 * The collaborators an action reaches for, recorded. Only the members the
 * actions actually use are here; the rest of each module is not this test's
 * business.
 */
function createStubs(getSearchUrl: () => string = () => DEFAULT_SEARCH_URL) {
  const active = {
    // SAFETY: cast narrows the literal `{ url: string }` for the test stub; the object is built right above.
    snapshot: () => ({ url: "https://active.example" }) as { url: string },
    navigate: vi.fn<(url: string) => void>(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    scroll: vi.fn<(command: string) => void>(),
    findNext: vi.fn<(forward: boolean) => void>(),
    stopFind: vi.fn(),
    showHints: vi.fn(),
    hideHints: vi.fn(),
    hintKey: vi.fn<(key: string) => void>(),
    toggleDevTools: vi.fn(),
    blur: vi.fn(),
    focus: vi.fn(),
  };
  const tabs = {
    active,
    create: vi.fn<(url?: string) => void>(),
    closeActive: vi.fn(),
    step: vi.fn<(offset: number) => void>(),
  };
  const downloads = {
    cancelNth: vi.fn<(row?: number) => void>(),
    clear: vi.fn(),
  };
  const permissions = {
    answerHead: vi.fn<(allow: boolean) => void>(),
  };
  const sent: { channel: string; payload?: unknown }[] = [];
  const win = {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload?: unknown) => sent.push({ channel, payload }),
      focus: vi.fn(),
    },
  };
  const quit = vi.fn();
  const messages = { warn: vi.fn<(text: string) => void>(), say: vi.fn<(text: string) => void>() };
  const clipboard = createClipboardStub();

  // SAFETY: partial stubs — createActions only reaches the members defined above.
  const actions = createActions(
    tabs as unknown as TabManager,
    downloads as unknown as Downloads,
    permissions as unknown as Permissions,
    win as unknown as BrowserWindow,
    messages as unknown as Messages,
    clipboard,
    quit,
    getSearchUrl,
  );
  return {
    commands: createCommands(actions),
    tabs,
    active,
    downloads,
    permissions,
    sent,
    win,
    messages,
    clipboard,
    quit,
  };
}

test("an unknown command is reported rather than thrown", () => {
  const { commands } = createStubs();
  expect(commands.execute("tab.nope")).toBe(false);
  expect(commands.execute("tab.next")).toBe(true);
});

test("what every object inherits is not a command", () => {
  const { commands } = createStubs();
  for (const inherited of ["toString", "valueOf", "constructor", "hasOwnProperty", "__proto__"]) {
    expect(commands.execute(inherited)).toBe(false);
  }
});

test("every command reaches the thing it names", () => {
  const { commands, tabs, active, downloads, permissions, sent, win, clipboard, quit } =
    createStubs();
  // One entry per command in the table, so a mapping that points at the wrong
  // action is caught rather than merely dispatching.
  const expected: [string, () => boolean][] = [
    ["tab.new", () => tabs.create.mock.calls.length === 1],
    ["tab.close", () => tabs.closeActive.mock.calls.length === 1],
    ["tab.next", () => tabs.step.mock.calls.some(([offset]) => offset === 1)],
    ["tab.prev", () => tabs.step.mock.calls.some(([offset]) => offset === -1)],
    ["nav.back", () => active.goBack.mock.calls.length === 1],
    ["nav.forward", () => active.goForward.mock.calls.length === 1],
    ["nav.reload", () => active.reload.mock.calls.length === 1],
    ["nav.open", () => true], // needs an argument; covered on its own below
    ["scroll.down", () => active.scroll.mock.calls.some(([c]) => c === "down")],
    ["scroll.up", () => active.scroll.mock.calls.some(([c]) => c === "up")],
    ["scroll.half-down", () => active.scroll.mock.calls.some(([c]) => c === "half-down")],
    ["scroll.half-up", () => active.scroll.mock.calls.some(([c]) => c === "half-up")],
    ["scroll.top", () => active.scroll.mock.calls.some(([c]) => c === "top")],
    ["scroll.bottom", () => active.scroll.mock.calls.some(([c]) => c === "bottom")],
    ["find.next", () => active.findNext.mock.calls.some(([forward]) => forward === true)],
    ["find.prev", () => active.findNext.mock.calls.some(([forward]) => forward === false)],
    ["find.clear", () => active.stopFind.mock.calls.length === 1],
    ["hints.show", () => active.showHints.mock.calls.length === 1],
    ["hints.hide", () => active.hideHints.mock.calls.length === 1],
    ["hints.key", () => true], // needs an argument; covered on its own below
    ["focus.page", () => active.focus.mock.calls.length === 1],
    // Ahead of focus.omnibox below, which is the only other caller of it.
    ["focus.chrome", () => win.webContents.focus.mock.calls.length === 1],
    ["focus.omnibox", () => sent.some(({ channel }) => channel === wire("focusOmnibox"))],
    ["insert.leave", () => active.blur.mock.calls.length === 1],
    ["downloads.toggle", () => sent.some(({ channel }) => channel === wire("downloadsToggle"))],
    ["downloads.clear", () => downloads.clear.mock.calls.length === 1],
    ["downloads.cancel", () => downloads.cancelNth.mock.calls.length === 1],
    ["permission.allow", () => permissions.answerHead.mock.calls.some(([a]) => a === true)],
    ["permission.deny", () => permissions.answerHead.mock.calls.some(([a]) => a === false)],
    ["clipboard.yank", () => clipboard.write.mock.calls.length === 1],
    // Both reads need their own focused tests; here only the dispatch is
    // covered, so an action wired to nothing fails the row rather than
    // masking the bug.
    ["clipboard.open", () => true],
    ["clipboard.openNewTab", () => true],
    ["app.quit", () => quit.mock.calls.length === 1],
    ["app.devtools", () => active.toggleDevTools.mock.calls.length === 1],
  ];

  for (const [name, landed] of expected) {
    expect(commands.execute(name), `${name} dispatches`).toBe(true);
    expect(landed(), `${name} reaches its action`).toBe(true);
  }
});

test("aliases run the command they stand for", () => {
  const { commands, tabs, quit } = createStubs();

  commands.execute("q");
  expect(tabs.closeActive).toHaveBeenCalledTimes(1);

  commands.execute("qa");
  expect(quit).toHaveBeenCalledTimes(1);
});

test("a bare host is opened as https, and anything else is searched for", () => {
  const { commands, active } = createStubs();

  commands.execute("o", "example.com");
  expect(active.navigate).toHaveBeenCalledWith("https://example.com");

  commands.execute("nav.open", "some words");
  expect(active.navigate).toHaveBeenLastCalledWith("https://duckduckgo.com/?q=some%20words");

  commands.execute("nav.open", "kvist://newtab");
  expect(active.navigate).toHaveBeenLastCalledWith("kvist://newtab");
});

test("the search template comes from the config, not from resolveUrl", () => {
  const { commands, active } = createStubs(() => "https://search.example/find?q={q}");

  commands.execute("nav.open", "some words");
  expect(active.navigate).toHaveBeenLastCalledWith("https://search.example/find?q=some%20words");
});

test("nav.open without a URL does nothing", () => {
  const { commands, active } = createStubs();
  commands.execute("nav.open");
  expect(active.navigate).not.toHaveBeenCalled();
});

test("a new tab takes a URL, or the homepage when given none", () => {
  const { commands, tabs } = createStubs();

  commands.execute("tabnew", "example.com");
  expect(tabs.create).toHaveBeenCalledWith("https://example.com");

  commands.execute("tab.new");
  expect(tabs.create).toHaveBeenLastCalledWith(undefined);
});

test("tab.next and tab.prev step either way", () => {
  const { commands, tabs } = createStubs();
  commands.execute("tab.next");
  commands.execute("tab.prev");
  expect(tabs.step.mock.calls).toEqual([[1], [-1]]);
});

test("each scroll command names its own movement", () => {
  const { commands, active } = createStubs();
  for (const name of [
    "scroll.down",
    "scroll.up",
    "scroll.half-down",
    "scroll.half-up",
    "scroll.top",
    "scroll.bottom",
  ]) {
    commands.execute(name);
  }
  expect(active.scroll.mock.calls.flat()).toEqual([
    "down",
    "up",
    "half-down",
    "half-up",
    "top",
    "bottom",
  ]);
});

test("a download row is a number, and anything else is no row at all", () => {
  const { commands, downloads, messages } = createStubs();

  commands.execute("downloads.cancel", "2");
  expect(downloads.cancelNth).toHaveBeenCalledWith(2);

  // No row named: the newest transfer still moving.
  commands.execute("downloads.cancel");
  expect(downloads.cancelNth).toHaveBeenLastCalledWith();

  // A typo is told to the user rather than to a console they cannot see.
  for (const typo of ["x", "0", "-1", "1.5"]) commands.execute("downloads.cancel", typo);
  expect(downloads.cancelNth).toHaveBeenCalledTimes(2);
  expect(messages.warn).toHaveBeenCalledTimes(4);
  expect(messages.warn).toHaveBeenLastCalledWith("not a download row: 1.5");
});

test("hints.key passes the key on, and nothing without one", () => {
  const { commands, active } = createStubs();

  commands.execute("hints.key", "a");
  expect(active.hintKey).toHaveBeenCalledWith("a");

  commands.execute("hints.key");
  expect(active.hintKey).toHaveBeenCalledTimes(1);
});

test("leaving insert mode drops the page's focus before taking it back", () => {
  const { commands, active } = createStubs();
  const order: string[] = [];
  active.blur.mockImplementation(() => order.push("blur"));
  active.focus.mockImplementation(() => order.push("focus"));

  commands.execute("insert.leave");

  expect(order).toEqual(["blur", "focus"]);
});

test("focusing the omnibox moves window focus first, then asks the chrome", () => {
  const { commands, sent, win } = createStubs();

  commands.execute("focus.omnibox");

  expect(win.webContents.focus).toHaveBeenCalled();
  expect(sent).toEqual([{ channel: wire("focusOmnibox"), payload: undefined }]);
});

test("the downloads panel is asked to toggle, since the flag is the chrome's", () => {
  const { commands, sent } = createStubs();
  commands.execute("downloads");
  expect(sent).toEqual([{ channel: wire("downloadsToggle"), payload: undefined }]);
});

test("yank copies the active tab's URL and announces it", () => {
  const { commands, clipboard, messages } = createStubs();

  commands.execute("clipboard.yank");

  expect(clipboard.write).toHaveBeenCalledWith("https://active.example");
  expect(messages.say).toHaveBeenCalledWith("yanked https://active.example");
  expect(messages.warn).not.toHaveBeenCalled();
});

test("yank with no active tab warns rather than writing an empty string", () => {
  const stubs = createStubs();
  Object.defineProperty(stubs.tabs, "active", { value: undefined, configurable: true });

  stubs.commands.execute("clipboard.yank");

  expect(stubs.clipboard.write).not.toHaveBeenCalled();
  expect(stubs.messages.warn).toHaveBeenCalledWith("no URL to yank");
});

test("yank with an empty URL warns rather than writing an empty string", () => {
  const { commands, active, clipboard, messages } = createStubs();
  Object.defineProperty(active, "snapshot", {
    value: () => ({ url: "" }),
    configurable: true,
  });

  commands.execute("clipboard.yank");

  expect(clipboard.write).not.toHaveBeenCalled();
  expect(messages.warn).toHaveBeenCalledWith("no URL to yank");
});

test("open reads the clipboard and navigates the active tab through resolveUrl", () => {
  const { commands, active, clipboard } = createStubs();

  commands.execute("clipboard.open");

  expect(clipboard.read).toHaveBeenCalled();
  expect(active.navigate).toHaveBeenCalledWith("https://clipboard.example");
});

test("open turns a search phrase on the clipboard into a search URL", () => {
  const { commands, active, clipboard } = createStubs();
  clipboard.read.mockReturnValue("some words");

  commands.execute("clipboard.open");

  expect(active.navigate).toHaveBeenCalledWith("https://duckduckgo.com/?q=some%20words");
});

test("open honours the configured search template", () => {
  const { commands, active, clipboard } = createStubs(() => "https://search.example/find?q={q}");
  clipboard.read.mockReturnValue("some words");

  commands.execute("clipboard.open");

  expect(active.navigate).toHaveBeenCalledWith("https://search.example/find?q=some%20words");
});

test("open trims whitespace before resolving", () => {
  const { commands, active, clipboard } = createStubs();
  clipboard.read.mockReturnValue("  https://x.example  \n");

  commands.execute("clipboard.open");

  expect(active.navigate).toHaveBeenCalledWith("https://x.example");
});

test("open warns and does nothing when the clipboard is empty", () => {
  const { commands, active, clipboard, messages } = createStubs();
  clipboard.read.mockReturnValue("");

  commands.execute("clipboard.open");

  expect(messages.warn).toHaveBeenCalledWith("clipboard is empty");
  expect(active.navigate).not.toHaveBeenCalled();
});

test("open warns and does nothing when there is no active tab", () => {
  const stubs = createStubs();
  Object.defineProperty(stubs.tabs, "active", { value: undefined, configurable: true });

  stubs.commands.execute("clipboard.open");

  expect(stubs.messages.warn).toHaveBeenCalledWith("no active tab");
  expect(stubs.active.navigate).not.toHaveBeenCalled();
});

test("openNewTab reads the clipboard and creates a tab with the resolved URL", () => {
  const { commands, tabs, clipboard } = createStubs();

  commands.execute("clipboard.openNewTab");

  expect(clipboard.read).toHaveBeenCalled();
  expect(tabs.create).toHaveBeenCalledWith("https://clipboard.example");
});

test("openNewTab treats a phrase as a search through the configured template", () => {
  const { commands, tabs, clipboard } = createStubs();
  clipboard.read.mockReturnValue("what is a wren");

  commands.execute("clipboard.openNewTab");

  expect(tabs.create).toHaveBeenCalledWith("https://duckduckgo.com/?q=what%20is%20a%20wren");
});

test("openNewTab warns and does nothing when the clipboard is empty", () => {
  const { commands, tabs, clipboard, messages } = createStubs();
  clipboard.read.mockReturnValue("");

  commands.execute("clipboard.openNewTab");

  expect(messages.warn).toHaveBeenCalledWith("clipboard is empty");
  expect(tabs.create).not.toHaveBeenCalled();
});

test("openNewTab still creates a tab when there is no active one", () => {
  const stubs = createStubs();
  Object.defineProperty(stubs.tabs, "active", { value: undefined, configurable: true });

  stubs.commands.execute("clipboard.openNewTab");

  expect(stubs.tabs.create).toHaveBeenCalledWith("https://clipboard.example");
  expect(stubs.messages.warn).not.toHaveBeenCalled();
});
