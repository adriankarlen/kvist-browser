import type { UserConfig } from "./config";

export type TabId = number;

export type Mode = "normal" | "insert" | "command";

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

export const CHANNELS = {
  state: "kvist:state",
  config: "kvist:config",
  mode: "kvist:mode",
  setMode: "kvist:set-mode",
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
