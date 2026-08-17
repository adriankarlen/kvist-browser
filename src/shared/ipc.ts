import type { UserConfig } from "./config";

export type TabId = number;

export type Mode = "normal" | "insert" | "command" | "hint" | "find";

/** Scrolling lives in the page, so main names the movement rather than the pixels. */
export type ScrollCommand = "down" | "up" | "half-down" | "half-up" | "top" | "bottom";

export interface TabState {
  id: TabId;
  title: string;
  url: string;
  favicon: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

/** Where a find has got to, as `found-in-page` reports it. */
export interface FindResult {
  query: string;
  matches: number;
  /** 1-based index of the highlighted match; 0 when there are none. */
  active: number;
}

export interface BrowserState {
  tabs: TabState[];
  activeId: TabId | null;
}

/** Where a download has got to, as Chromium's `DownloadItem` reports it. */
export type DownloadStatus = "progressing" | "paused" | "completed" | "cancelled" | "interrupted";

export interface DownloadState {
  /** Ours, not Chromium's — a `DownloadItem` carries no stable identifier. */
  id: number;
  /** Basename of the path we chose, which is not always what the server suggested. */
  filename: string;
  url: string;
  status: DownloadStatus;
  receivedBytes: number;
  /** 0 when the server sent no length, which is what makes progress unknowable. */
  totalBytes: number;
}

/** One row of the context menu; a separator is a row of its own. */
export type ContextMenuItem =
  | { type: "separator" }
  | {
      type: "item";
      id: string;
      label: string;
      enabled: boolean;
      /** Right-aligned hint slot, reserved for e.g. keybinds; unset for now. */
      hint?: string;
    };

/**
 * Everything the page needs to render its context menu, in page coordinates.
 * null hides the menu instead.
 */
export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
  /**
   * tokens + menu styles + the user's config.css, injected into the menu's
   * shadow root so it themes exactly like the chrome.
   */
  css: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export const CHANNELS = {
  state: "kvist:state",
  config: "kvist:config",
  mode: "kvist:mode",
  setMode: "kvist:set-mode",
  /** A tab reporting whether its focused element accepts typing. */
  pageEditable: "kvist:page-editable",
  /** Asks a tab to blur whatever it has focused, so normal mode regains the keyboard. */
  pageBlur: "kvist:page-blur",
  pageScroll: "kvist:page-scroll",
  /** Hint mode: main drives, the page renders the labels and does the matching. */
  hintsShow: "kvist:hints-show",
  hintsKey: "kvist:hints-key",
  hintsHide: "kvist:hints-hide",
  /**
   * Where the page wants a real click. Chromium marks history entries created
   * without user activation as skippable, and a scripted `.click()` has none —
   * so back would silently stop working after following a hint.
   */
  hintsClick: "kvist:hints-click",
  /** The page reporting that hinting ended, so main can leave hint mode. */
  hintsDone: "kvist:hints-done",
  /** Find-in-page: the chrome types the query, main drives `findInPage`. */
  find: "kvist:find",
  findStop: "kvist:find-stop",
  /** Match counts back to the chrome; null once a find is over. */
  findResult: "kvist:find-result",
  /**
   * Context menu: main tells the tab what to show (or null to hide), the tab
   * reports the picked item id back — or null when dismissed without one.
   * Rendered in the page itself, because the tab's view paints over the
   * chrome and chrome HTML can never overlap it.
   */
  contextMenu: "kvist:context-menu",
  contextMenuPick: "kvist:context-menu-pick",
  /**
   * Downloads: full-snapshot list to the chrome, plus a nudge for `:downloads`.
   * The panel's pinned flag is the chrome's own state, so the command can only
   * ask it to toggle — the same shape as `focusOmnibox`.
   */
  downloads: "kvist:downloads",
  downloadsToggle: "kvist:downloads-toggle",
  runCommand: "kvist:run-command",
  contentRect: "kvist:content-rect",
  createTab: "kvist:create-tab",
  focusOmnibox: "kvist:focus-omnibox",
  closeTab: "kvist:close-tab",
  activateTab: "kvist:activate-tab",
  navigate: "kvist:navigate",
  goBack: "kvist:go-back",
  goForward: "kvist:go-forward",
  reload: "kvist:reload",
  toggleDevTools: "kvist:toggle-devtools",
} as const;

export interface KvistApi {
  onState: (listener: (state: BrowserState) => void) => () => void;
  onConfig: (listener: (config: UserConfig) => void) => () => void;
  onMode: (listener: (mode: Mode) => void) => () => void;
  setMode: (mode: Mode) => void;
  onFindResult: (listener: (result: FindResult | null) => void) => () => void;
  onDownloads: (listener: (downloads: DownloadState[]) => void) => () => void;
  /** `:downloads` asking the chrome to pin its panel open, or let it go again. */
  onToggleDownloads: (listener: () => void) => () => void;
  /** Restarts the search from the top; an empty query stops it. */
  find: (query: string) => void;
  stopFind: () => void;
  runCommand: (line: string) => void;
  /** Chrome asks main to focus the omnibox input; main only moves window focus. */
  onFocusOmnibox: (listener: () => void) => () => void;
  /** Reports the chrome's content rectangle so the active tab can be positioned under it. */
  setContentRect: (rect: Rect) => void;
  createTab: (url?: string) => void;
  closeTab: (id: TabId) => void;
  activateTab: (id: TabId) => void;
  navigate: (url: string) => void;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  toggleDevTools: () => void;
}
