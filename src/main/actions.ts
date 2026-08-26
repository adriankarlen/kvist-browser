import type { BrowserWindow } from "electron";
import { senders, toChrome } from "../shared/ipc";
import { originOf, resolveUrl } from "../shared/url";
import type { Downloads } from "./downloads";
import type { Messages } from "./messages";
import type { Permissions } from "./permissions";
import type { TabManager } from "./tab-manager";
import { clamp, STEP } from "./zoom";

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
 * The slice of the zoom store the action layer reads and writes. The store
 * owns the persistence and the debounce; the actions only ask for a level
 * or hand one back.
 */
export interface ZoomStoreAccess {
  get(origin: string): number;
  set(origin: string, level: number): void;
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
  zoom: {
    /** Add a step; clamped at the upper limit. */
    in: Action;
    /** Subtract a step; clamped at the lower limit. */
    out: Action;
    /** Set the level to 0 — the saved value is reapplied on next navigation. */
    reset: Action;
    /**
     * Set the level to the parsed argument (in the same units as
     * `webContents.setZoomLevel`). A non-numeric argument is a no-op plus a
     * warning, so a typo does not silently change the level.
     */
    set: Action;
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
  zoom: ZoomStoreAccess,
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

  /**
   * Whether the active tab has a URL whose zoom we should remember. Pages
   * without a persistable origin (about:blank, data:, mailto:) cannot have a
   * per-origin preference anyway, so the keybinds are no-ops there.
   */
  const zoomableOrigin = (): string | null => {
    const active = tabs.active;
    if (active === undefined) return null;
    // An error page is a local page standing in for a failed load. The
    // snapshot's URL is already the failed site's with the wrapper stripped,
    // so it cannot be told apart by parsing — only the tab's own state knows.
    // Keying zoom off it would overwrite the site's saved level with whatever
    // the wrapper happened to show.
    if (active.showsErrorPage) return null;
    const url = active.snapshot().url;
    if (url === "") return null;
    return originOf(url);
  };

  const setActiveZoom = (level: number): void => {
    const origin = zoomableOrigin();
    if (origin === null) {
      messages.warn("no zoomable page here");
      return;
    }
    const applied = tabs.active?.setZoomLevel(level);
    if (applied === null || applied === undefined) return;
    // Pin to whatever Chromium actually accepted, so the stored value matches.
    zoom.set(origin, applied);
    messages.say(`zoom ${zoomPercent(applied)}`);
  };

  /**
   * Resets only the current view: the saved level stays, so the next
   * navigation reapplies it — mirroring Chrome's Ctrl+0. To make the reset
   * sticky, `:zoom 0` writes through to the store instead.
   */
  const resetActiveZoomView = (): void => {
    const active = tabs.active;
    if (active === undefined) return;
    const origin = zoomableOrigin();
    if (origin === null) {
      messages.warn("no zoomable page here");
      return;
    }
    active.setZoomLevel(0);
    messages.say("zoom 100%");
  };

  const zoomPercent = (level: number): string => `${Math.round(100 * 1.2 ** level)}%`;

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
    zoom: {
      in: () => {
        const current = tabs.active?.zoomLevel ?? 0;
        setActiveZoom(clamp(current + STEP));
      },
      out: () => {
        const current = tabs.active?.zoomLevel ?? 0;
        setActiveZoom(clamp(current - STEP));
      },
      // Reset only changes the current view — the saved level is reapplied on
      // next navigation, matching Chrome's Ctrl+0 behaviour.
      reset: resetActiveZoomView,
      set: (arg) => {
        if (arg === undefined || arg.trim() === "") {
          messages.warn(
            "zoom needs a level, e.g. `:zoom 1.5` or `:zoom -1` (`:z0` resets only the current view)",
          );
          return;
        }
        const level = Number(arg);
        if (!Number.isFinite(level)) {
          messages.warn(`not a zoom level: ${arg}`);
          return;
        }
        setActiveZoom(level);
      },
    },
    app: {
      quit,
      devtools: () => tabs.active?.toggleDevTools(),
    },
  };
}
