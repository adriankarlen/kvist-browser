export type { InputMode, NewtabLink, RecipeStyle, Settings, UserConfig } from "./schema/config";

import { DEFAULT_LAYOUT } from "./layout";
import type { Settings, UserConfig } from "./schema/config";

/** The recipe a config that names none gets: today's look, so an upgrade changes nothing. */
export const DEFAULT_RECIPE = "tui";

export const DEFAULT_SETTINGS: Settings = {
  recipe: DEFAULT_RECIPE,
  homepage: "kvist://newtab",
  searchUrl: "https://duckduckgo.com/?q={q}",
  newtabTimezone: undefined,
  newtabLinks: [
    { name: "github", url: "https://github.com" },
    { name: "youtube", url: "https://youtube.com" },
  ],
  layout: DEFAULT_LAYOUT,
  tabFocusPage: true,
  inputMode: "vim",
  // Only main can read the command registry; it fills these in before anything is applied.
  keymap: { name: "vim", bindings: [] },
  adblock: true,
  downloadDir: undefined,
};

/** Both config files missing, and the default recipe adding nothing. */
export const DEFAULT_CONFIG: UserConfig = {
  css: "",
  recipe: { name: DEFAULT_RECIPE, css: "" },
  settings: DEFAULT_SETTINGS,
};

/**
 * One thing wrong with the user's config: which field, and why it could not be
 * used. Invalid values are ignored rather than fatal, so a problem is the only
 * trace left of something the user meant.
 */
export interface Problem {
  /** Dotted path as the file spells it, e.g. "newtab.timezone". */
  field: string;
  reason: string;
  /** The file it was found in, when that is not config.toml, e.g. "recipes/modern.toml". */
  file?: string;
}
