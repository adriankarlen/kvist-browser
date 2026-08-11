import type { BrowserWindow } from "electron";
import type { ScrollCommand } from "../shared/ipc";
import { CHANNELS } from "../shared/ipc";
import type { TabManager } from "./tab-manager";

export interface Api {
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
  app: {
    quit(): void;
    devtools(): void;
  };
}

export function createApi(tabs: TabManager, win: BrowserWindow, quit: () => void): Api {
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
      back: () => tabs.goBack(),
      forward: () => tabs.goForward(),
      reload: () => tabs.reload(),
      open: (url) => tabs.navigate(url),
    },
    scroll: {
      to: (direction) => tabs.scrollActive(direction),
    },
    find: {
      next: () => tabs.findNext(true),
      prev: () => tabs.findNext(false),
      clear: () => tabs.stopFind(),
    },
    hints: {
      show: () => tabs.showHints(),
      hide: () => tabs.hideHints(),
      key: (char) => tabs.hintKey(char),
    },
    focus: {
      page: () => tabs.focusActive(),
      chrome: () => win.webContents.focus(),
      omnibox: () => {
        win.webContents.focus();
        send(CHANNELS.focusOmnibox, null);
      },
      blurPage: () => tabs.blurActive(),
    },
    app: {
      quit,
      devtools: () => tabs.toggleDevTools(),
    },
  };
}
