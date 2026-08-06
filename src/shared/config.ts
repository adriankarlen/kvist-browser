export type TabOrientation = "horizontal" | "vertical";

export interface Settings {
  homepage: string;
  tabOrientation: TabOrientation;
  /**
   * Hand keyboard focus back to the page after a tab action. Vim keys only
   * reach main from a focused webContents, so turning this off means tab
   * switches leave the keyboard on the chrome.
   */
  tabFocusPage: boolean;
  /**
   * Unpacked extension directories, absolute or relative to the config dir.
   * Read once at startup; Chromium loads extensions per session and does not
   * persist them across boots.
   */
  extensions: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  homepage: "https://example.com",
  tabOrientation: "horizontal",
  tabFocusPage: true,
  extensions: [],
};

export interface UserConfig {
  /** Contents of config.css, injected unlayered so it outranks everything Kvist ships. */
  css: string;
  settings: Settings;
}
