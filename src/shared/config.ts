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
  /** Network and cosmetic filtering, from the prebuilt ads + tracking lists. */
  adblock: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  homepage: "kvist://newtab",
  tabOrientation: "horizontal",
  tabFocusPage: true,
  adblock: true,
};

export interface UserConfig {
  /** Contents of config.css, injected unlayered so it outranks everything Kvist ships. */
  css: string;
  settings: Settings;
}
