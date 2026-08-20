import type { BrowserWindow } from "electron";
import type { ScrollCommand } from "../shared/ipc";
import { CHANNELS } from "../shared/ipc";
import type { Downloads } from "./downloads";
import type { TabManager } from "./tab-manager";

export interface Actions {
  tabs: {
    create(url?: string): void;
    close(): void;
    next(): void;
    prev(): void;
  };
  nav: {
    back(): void;
    forward(): void;
    reload(): void;
    open(url: string): void;
  };
  scroll: {
    to(direction: ScrollCommand): void;
  };
  find: {
    next(): void;
    prev(): void;
    clear(): void;
  };
  hints: {
    show(): void;
    hide(): void;
    key(char: string): void;
  };
  focus: {
    page(): void;
    chrome(): void;
    omnibox(): void;
    blurPage(): void;
  };
  downloads: {
    toggle(): void;
    clear(): void;
    /** The nth row as the panel shows it, or the newest live transfer. */
    cancel(target?: string): void;
  };
  app: {
    quit(): void;
    devtools(): void;
  };
}

export function createActions(
  tabs: TabManager,
  downloads: Downloads,
  win: BrowserWindow,
  quit: () => void,
): Actions {
  const send = (channel: string, payload?: unknown): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };

  return {
    tabs: {
      create: (url?) => tabs.create(url),
      close: () => tabs.closeActive(),
      next: () => tabs.step(1),
      prev: () => tabs.step(-1),
    },
    nav: {
      back: () => tabs.active?.goBack(),
      forward: () => tabs.active?.goForward(),
      reload: () => tabs.active?.reload(),
      open: (url) => tabs.active?.navigate(url),
    },
    scroll: {
      to: (direction) => tabs.active?.scroll(direction),
    },
    find: {
      next: () => tabs.active?.findNext(true),
      prev: () => tabs.active?.findNext(false),
      clear: () => tabs.active?.stopFind(),
    },
    hints: {
      show: () => tabs.active?.showHints(),
      hide: () => tabs.active?.hideHints(),
      key: (char) => tabs.active?.hintKey(char),
    },
    focus: {
      page: () => tabs.active?.focus(),
      chrome: () => {
        if (!win.isDestroyed()) win.webContents.focus();
      },
      omnibox: () => {
        if (!win.isDestroyed()) win.webContents.focus();
        send(CHANNELS.focusOmnibox, null);
      },
      blurPage: () => tabs.active?.blur(),
    },
    downloads: {
      // The panel's pinned flag is the chrome's, so this can only ask.
      toggle: () => send(CHANNELS.downloadsToggle),
      clear: () => downloads.clear(),
      cancel: (target) => {
        // A command argument is a string; anything that is not a row number is
        // no row at all, and cancelling the newest transfer instead would be a
        // surprising answer to a typo.
        if (target === undefined) return downloads.cancelNth();
        const n = Number(target);
        if (!Number.isInteger(n) || n < 1) {
          console.error(`kvist: not a download row: ${target}`);
          return;
        }
        downloads.cancelNth(n);
      },
    },
    app: {
      quit,
      devtools: () => tabs.active?.toggleDevTools(),
    },
  };
}
