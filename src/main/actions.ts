import type { BrowserWindow } from "electron";
import { senders, toChrome } from "../shared/ipc";
import { resolveUrl } from "../shared/url";
import type { Downloads } from "./downloads";
import type { Messages } from "./messages";
import type { Permissions } from "./permissions";
import type { TabManager } from "./tab-manager";

/**
 * Every action takes the command's argument, because a command line is the
 * only thing that calls one and a command line carries strings. Most ignore it.
 */
export type Action = (arg?: string) => void;

/**
 * The system clipboard, narrowed to the two verbs Kvist uses. Reads return
 * whatever the OS has — a yank from another app is still a yank — and the
 * caller decides what an empty string means.
 */
export interface Clipboard {
  read(): string;
  write(text: string): void;
}

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
  permissions: {
    /** Answer the question the prompt line is showing. */
    allow: Action;
    deny: Action;
  };
  clipboard: {
    /** Copy the active tab's URL to the system clipboard. */
    yank: Action;
    /** Open the clipboard contents in the active tab, via resolveUrl. */
    open: Action;
    /** Open the clipboard contents in a new tab, via resolveUrl. */
    openNewTab: Action;
  };
  app: {
    quit: Action;
    devtools: Action;
  };
}

export function createActions(
  tabs: TabManager,
  downloads: Downloads,
  permissions: Permissions,
  win: BrowserWindow,
  messages: Messages,
  clipboard: Clipboard,
  quit: () => void,
  getSearchUrl: () => string,
): Actions {
  const chrome = senders(toChrome, (channel, payload) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  });

  const focusChrome = (): void => {
    if (!win.isDestroyed()) win.webContents.focus();
  };

  return {
    tabs: {
      create: (arg) => tabs.create(arg ? resolveUrl(arg, getSearchUrl()) : undefined),
      close: () => tabs.closeActive(),
      next: () => tabs.step(1),
      prev: () => tabs.step(-1),
    },
    nav: {
      back: () => tabs.active?.goBack(),
      forward: () => tabs.active?.goForward(),
      reload: () => tabs.active?.reload(),
      open: (arg) => {
        if (arg) tabs.active?.navigate(resolveUrl(arg, getSearchUrl()));
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
    permissions: {
      allow: () => permissions.answerHead(true),
      deny: () => permissions.answerHead(false),
    },
    clipboard: {
      // The snapshot already strips the kvist://error wrapper off, so what
      // is on the wire matches what the user sees in the omnibox — and a
      // freshly opened tab is empty rather than yet another about:blank.
      yank: () => {
        const url = tabs.active?.snapshot().url;
        if (url === undefined || url === "") {
          messages.warn("no URL to yank");
          return;
        }
        clipboard.write(url);
        messages.say(`yanked ${url}`);
      },
      open: () => {
        const text = clipboard.read().trim();
        if (text === "") {
          messages.warn("clipboard is empty");
          return;
        }
        const active = tabs.active;
        if (active === undefined) {
          messages.warn("no active tab");
          return;
        }
        active.navigate(resolveUrl(text, getSearchUrl()));
      },
      // No active tab is fine here: opening in a new tab creates the tab.
      openNewTab: () => {
        const text = clipboard.read().trim();
        if (text === "") {
          messages.warn("clipboard is empty");
          return;
        }
        tabs.create(resolveUrl(text, getSearchUrl()));
      },
    },
    app: {
      quit,
      devtools: () => tabs.active?.toggleDevTools(),
    },
  };
}
