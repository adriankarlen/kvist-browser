import { Schema } from "effect";

/** One row of the context menu; a separator is a row of its own. */
export const ContextMenuItem = Schema.Union([
  Schema.Struct({ type: Schema.Literal("separator") }),
  Schema.Struct({
    type: Schema.Literal("item"),
    id: Schema.String,
    label: Schema.String,
    enabled: Schema.Boolean,
    /** Right-aligned hint slot, reserved for e.g. keybinds. */
    hint: Schema.optionalKey(Schema.String),
  }),
]);

export type ContextMenuItem = typeof ContextMenuItem.Type;

/** The menu in page coordinates, with the CSS that themes it like the chrome. */
export const ContextMenuState = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  items: Schema.Array(ContextMenuItem),
  css: Schema.String,
});

export type ContextMenuState = typeof ContextMenuState.Type;
