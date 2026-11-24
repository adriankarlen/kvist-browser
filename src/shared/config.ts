export type { InputMode, NewtabLink, Settings, UserConfig } from "./schema/config";

import { DEFAULT_LAYOUT } from "./layout";
import type { Settings } from "./schema/config";

export const DEFAULT_SETTINGS: Settings = {
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
  adblock: true,
  downloadDir: undefined,
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
}
