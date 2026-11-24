import type { UserConfig } from "./schema/config";

/** The order every surface declares first, so the recipe layer sits in the same place on each. */
export const LAYER_ORDER = "@layer kvist.reset, kvist.tokens, kvist.recipe, kvist.components;";

/**
 * config.css, then the recipe in its layer. Every surface injects this one
 * string, so a recipe reaches everything config.css does. config.css comes
 * first so its `@import` rules stay valid; being unlayered, it still wins.
 */
export function themeCss(config: Pick<UserConfig, "css" | "recipe">): string {
  return `${config.css}\n@layer kvist.recipe {\n${config.recipe.css}\n}\n`;
}
