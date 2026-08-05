export type TabOrientation = "horizontal" | "vertical";

export interface Settings {
  homepage: string;
  tabOrientation: TabOrientation;
}

export const DEFAULT_SETTINGS: Settings = {
  homepage: "https://example.com",
  tabOrientation: "horizontal",
};

export interface UserConfig {
  /** Contents of config.css, injected unlayered so it outranks everything Kvist ships. */
  css: string;
  settings: Settings;
}
