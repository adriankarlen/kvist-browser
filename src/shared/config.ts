export type TabOrientation = "horizontal" | "vertical";

export interface NewtabLink {
  name: string;
  url: string;
}

export interface Settings {
  homepage: string;
  /** Quick links on the default new tab page, from [[newtab.links]]. */
  newtabLinks: NewtabLink[];
  /**
   * Clock timezone on the new tab page, an IANA name or "UTC±n". Undefined
   * follows the system timezone.
   */
  newtabTimezone: string | undefined;
  tabOrientation: TabOrientation;
  /**
   * Hand keyboard focus back to the page after a tab action. Vim keys only
   * reach main from a focused webContents, so turning this off means tab
   * switches leave the keyboard on the chrome.
   */
  tabFocusPage: boolean;
  /** Network and cosmetic filtering, from the prebuilt ads + tracking lists. */
  adblock: boolean;
  /**
   * Where downloads are saved, from `[downloads] dir`. Undefined works it out
   * from the XDG download directory instead.
   */
  downloadDir: string | undefined;
}

export const DEFAULT_SETTINGS: Settings = {
  homepage: "kvist://newtab",
  newtabTimezone: undefined,
  newtabLinks: [
    { name: "github", url: "https://github.com" },
    { name: "youtube", url: "https://youtube.com" },
  ],
  tabOrientation: "horizontal",
  tabFocusPage: true,
  adblock: true,
  downloadDir: undefined,
};

export interface UserConfig {
  /** Contents of config.css, injected unlayered so it outranks everything Kvist ships. */
  css: string;
  settings: Settings;
}
