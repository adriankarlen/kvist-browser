import type { UserConfig } from "./config";

export type TabId = number;

export type Mode = "normal" | "insert" | "command" | "hint";

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

export interface BrowserState {
  tabs: TabState[];
  activeId: TabId | null;
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
