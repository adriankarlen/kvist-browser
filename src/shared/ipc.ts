import type { UserConfig } from "./config";

export type TabId = number;

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
  contentRect: "kvist:content-rect",
  createTab: "kvist:create-tab",
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
