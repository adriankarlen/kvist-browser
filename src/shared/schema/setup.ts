import { Schema } from "effect";
import { InputMode } from "./config";
import { Region } from "./layout";

/** How tightly the chrome is packed. Written to config.css as `--kv-density`. */
export const Density = Schema.Literals(["compact", "normal", "comfortable"]);

export type Density = typeof Density.Type;

/** Everything the wizard asks. Main turns it into config.toml and, for density, config.css. */
export const SetupChoices = Schema.Struct({
  recipe: Schema.String,
  inputMode: InputMode,
  omnibox: Region,
  tabs: Region,
  density: Density,
  /** A search URL template with `{q}`. */
  searchUrl: Schema.String,
});

export type SetupChoices = typeof SetupChoices.Type;

/** A recipe as the wizard offers it: what to call it, and the settings it brings. */
export const RecipeOption = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  inputMode: InputMode,
  omnibox: Region,
  tabs: Region,
});

export type RecipeOption = typeof RecipeOption.Type;

/** What the wizard needs before it can show the first step. */
export const SetupOptions = Schema.Struct({
  recipes: Schema.Array(RecipeOption),
  /** The recipe picked first, and the one Skip writes. */
  recipe: Schema.String,
  omniboxRegions: Schema.Array(Region),
  tabsRegions: Schema.Array(Region),
  /** False when config.css already exists: Kvist never edits it, so density cannot be saved. */
  densityAvailable: Schema.Boolean,
  searchUrl: Schema.String,
});

export type SetupOptions = typeof SetupOptions.Type;
