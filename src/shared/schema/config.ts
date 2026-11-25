import { Schema } from "effect";
import { Keymap } from "./keymap";
import { Layout } from "./layout";

export const NewtabLink = Schema.Struct({ name: Schema.String, url: Schema.String });

export type NewtabLink = typeof NewtabLink.Type;

/** The engine keys run on: modal vim, or the chords every other browser uses. */
export const InputMode = Schema.Literals(["vim", "standard"]);

export type InputMode = typeof InputMode.Type;

/** A recipe's file name without `.css`. The charset also keeps it inside the recipes directory. */
export const RecipeName = Schema.String.check(
  Schema.makeFilter((name: string) => /^[a-z0-9][a-z0-9-]*$/.test(name)),
);

export const Settings = Schema.Struct({
  /** The recipe in force, named by `recipe` in config.toml: the base look and defaults. */
  recipe: Schema.String,
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
  /** The engine of the preset `[input] mode` names. */
  inputMode: InputMode,
  /** That preset's keys, with config.toml's `[keys]` over them. */
  keymap: Keymap,
  /** Network and cosmetic filtering, from the prebuilt ads + tracking lists. */
  adblock: Schema.Boolean,
  /** Where downloads are saved. Undefined works it out from the XDG download directory. */
  downloadDir: Schema.UndefinedOr(Schema.String),
});

export type Settings = typeof Settings.Type;

/** The recipe in force: its name, and the CSS that goes in `@layer kvist.recipe`. */
export const RecipeStyle = Schema.Struct({ name: Schema.String, css: Schema.String });

export type RecipeStyle = typeof RecipeStyle.Type;

export const UserConfig = Schema.Struct({
  /** Contents of config.css, injected unlayered so it outranks everything Kvist ships. */
  css: Schema.String,
  recipe: RecipeStyle,
  settings: Settings,
});

export type UserConfig = typeof UserConfig.Type;
