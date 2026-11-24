import type { UserConfig } from "./schema/config";

/** The order every surface declares first, so the recipe layer sits in the same place on each. */
export const LAYER_ORDER = "@layer kvist.reset, kvist.tokens, kvist.recipe, kvist.components;";

/**
 * The recipe in its layer, then config.css unlayered. Every surface injects
 * this one string, so a recipe reaches everything config.css does, and the
 * user's file still wins.
 */
export function themeCss(config: Pick<UserConfig, "css" | "recipe">): string {
  return `@layer kvist.recipe {\n${config.recipe.css}\n}\n${config.css}`;
}
