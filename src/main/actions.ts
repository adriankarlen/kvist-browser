import type { BrowserWindow } from "electron";
import { senders, toChrome } from "../shared/ipc";
import { resolveUrl } from "../shared/url";
import type { Downloads } from "./downloads";
import type { Messages } from "./messages";
import type { TabManager } from "./tab-manager";

/**
 * Every action takes the command's argument, because a command line is the
 * only thing that calls one and a command line carries strings. Most ignore it.
 */
export type Action = (arg?: string) => void;

/**
 * What Kvist can be asked to do. Anything that has to interpret a string —
 * a URL, a download row — interprets it here: the command table is data, and
 * data cannot parse.
 */
export interface Actions {
  tabs: {
    /** A URL or search terms; the homepage when there is nothing to open. */
    create: Action;
    close: Action;
    next: Action;
    prev: Action;
  };
  nav: {
    back: Action;
    forward: Action;
    reload: Action;
    /** A URL or search terms, as typed. */
    open: Action;
  };
  scroll: {
    down: Action;
    up: Action;
    halfDown: Action;
    halfUp: Action;
    top: Action;
    bottom: Action;
  };
  find: {
    next: Action;
    prev: Action;
    clear: Action;
  };
  hints: {
    show: Action;
    hide: Action;
    /** The key a hint label is matched against. */
    key: Action;
  };
  focus: {
    page: Action;
    chrome: Action;
    omnibox: Action;
  };
  insert: {
    /** Leaving insert mode: drop whatever the page focused, take the keyboard back. */
    leave: Action;
  };
  downloads: {
    toggle: Action;
    clear: Action;
    /** The nth row as the panel shows it, or the newest live transfer. */
    cancel: Action;
  };
  app: {
    quit: Action;
    devtools: Action;
  };
}

export function createActions(
  tabs: TabManager,
  downloads: Downloads,
  win: BrowserWindow,
  messages: Messages,
  quit: () => void,
): Actions {
  const chrome = senders(toChrome, (channel, payload) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  });

  const focusChrome = (): void => {
    if (!win.isDestroyed()) win.webContents.focus();
  };

  return {
    tabs: {
      create: (arg) => tabs.create(arg ? resolveUrl(arg) : undefined),
      close: () => tabs.closeActive(),
      next: () => tabs.step(1),
      prev: () => tabs.step(-1),
    },
    nav: {
      back: () => tabs.active?.goBack(),
      forward: () => tabs.active?.goForward(),
      reload: () => tabs.active?.reload(),
      open: (arg) => {
        if (arg) tabs.active?.navigate(resolveUrl(arg));
      },
    },
    scroll: {
      down: () => tabs.active?.scroll("down"),
      up: () => tabs.active?.scroll("up"),
      halfDown: () => tabs.active?.scroll("half-down"),
      halfUp: () => tabs.active?.scroll("half-up"),
      top: () => tabs.active?.scroll("top"),
      bottom: () => tabs.active?.scroll("bottom"),
    },
    find: {
      next: () => tabs.active?.findNext(true),
      prev: () => tabs.active?.findNext(false),
      clear: () => tabs.active?.stopFind(),
    },
    hints: {
      show: () => tabs.active?.showHints(),
      hide: () => tabs.active?.hideHints(),
      key: (arg) => {
        if (arg) tabs.active?.hintKey(arg);
      },
    },
    focus: {
      page: () => tabs.active?.focus(),
      chrome: focusChrome,
      omnibox: () => {
        focusChrome();
        chrome.focusOmnibox();
      },
    },
    insert: {
      // Blur first: the page keeps the keyboard until whatever it focused
      // gives it up, and focusing the page again is what takes it back.
      leave: () => {
        tabs.active?.blur();
        tabs.active?.focus();
      },
    },
    downloads: {
      // The panel's pinned flag is the chrome's, so this can only ask.
      toggle: () => chrome.downloadsToggle(),
      // The panel may not even be up, so clearing is otherwise invisible.
      clear: () => {
        const cleared = downloads.clear();
        messages.say(cleared === 1 ? "cleared 1 download" : `cleared ${cleared} downloads`);
      },
      cancel: (arg) => {
        if (arg === undefined) {
          downloads.cancelNth();
          return;
        }
        // A command argument is a string; anything that is not a row number is
        // no row at all, and cancelling the newest transfer instead would be a
        // surprising answer to a typo.
        const row = Number(arg);
        if (!Number.isInteger(row) || row < 1) {
          messages.warn(`not a download row: ${arg}`);
          return;
        }
        downloads.cancelNth(row);
      },
    },
    app: {
      quit,
      devtools: () => tabs.active?.toggleDevTools(),
    },
  };
}
