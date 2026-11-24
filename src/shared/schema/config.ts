import { Schema } from "effect";
import { Layout } from "./layout";

export const NewtabLink = Schema.Struct({ name: Schema.String, url: Schema.String });

export type NewtabLink = typeof NewtabLink.Type;

/** Which keys drive the browser: the modal vim set, or the shortcuts every other browser uses. */
export const InputMode = Schema.Literals(["vim", "standard"]);

export type InputMode = typeof InputMode.Type;

export const Settings = Schema.Struct({
  homepage: Schema.String,
  /** Where a non-URL omnibox input goes; `{q}` is replaced with the encoded query. */
  searchUrl: Schema.String,
  /** Quick links on the default new tab page, from [[newtab.links]]. */
  newtabLinks: Schema.Array(NewtabLink),
  /** Clock timezone on the new tab page, an IANA name or "UTC±n". Undefined follows the system. */
  newtabTimezone: Schema.UndefinedOr(Schema.String),
  /** Where every chrome element lives, from the [layout.<element>] tables. */
  layout: Layout,
  /**
   * Hand keyboard focus back to the page after a tab action. Vim keys only
   * reach main from a focused webContents, so turning this off means tab
   * switches leave the keyboard on the chrome.
   */
  tabFocusPage: Schema.Boolean,
  /** From `[input] mode`. */
  inputMode: InputMode,
  /** Network and cosmetic filtering, from the prebuilt ads + tracking lists. */
  adblock: Schema.Boolean,
  /** Where downloads are saved. Undefined works it out from the XDG download directory. */
  downloadDir: Schema.UndefinedOr(Schema.String),
});

export type Settings = typeof Settings.Type;

export const UserConfig = Schema.Struct({
  /** Contents of config.css, injected unlayered so it outranks everything Kvist ships. */
  css: Schema.String,
  settings: Settings,
});

export type UserConfig = typeof UserConfig.Type;
