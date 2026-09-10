import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Restore state of the last closed window: `id` is 1, overwritten every
 * close. `tabsJson` holds tab-order URLs, `activeIndex` indexes them. The
 * orientation override is a runtime flip, not config; multi-window restore
 * is out of scope (KVI-27).
 */
export const session = sqliteTable("session", {
  id: integer("id").primaryKey(),
  tabsJson: text("tabs_json").notNull(),
  activeIndex: integer("active_index").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  x: integer("x"),
  y: integer("y"),
  /** 'horizontal' | 'vertical' | null — null means the chrome is following the config default. */
  orientation: text("orientation"),
  savedAt: integer("saved_at").notNull(),
});
