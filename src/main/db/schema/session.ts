import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The last closed window's restore state, single-row by convention (`id` is
 * always 1). Each `win.on("close")` overwrites it, so the most recently
 * closed window is what comes back on relaunch — multi-window restore is
 * explicitly out of scope for KVI-27.
 *
 * `tabsJson` is a JSON-encoded list of URLs in tab order, not a child
 * table: one session, one row, no joins. `activeIndex` indexes into that
 * list. `x` / `y` are nullable so a window without a remembered position
 * (first launch, headless, etc.) does not have to store a sentinel. The
 * orientation override lives here rather than on the user config because it
 * is a runtime UI flip, not something the user has written in `config.toml`.
 *
 * `savedAt` is wall-clock milliseconds at close time. It is not used for
 * restore logic today, but having it on the row means a future "stale
 * session" rule can reject a row older than N days without re-introducing
 * the column.
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
