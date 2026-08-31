import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * One row per committed main-frame navigation. A reload is its own row — a
 * fresh `visited_at` is closer to what Chrome does and to what omnibox
 * suggestions will want than upserting on URL. In-page (history-API)
 * navigations and failed loads do not land here; the writer filters them.
 *
 * `origin` is denormalized from `url` so per-site queries and any future
 * retention pass do not have to reparse every row. Nullable so a URL whose
 * origin we would not want to remember (`data:`, `blob:`) can still be
 * represented — though today the writer skips those entirely.
 */
export const history = sqliteTable("history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  url: text("url").notNull(),
  title: text("title").notNull(),
  origin: text("origin"),
  visitedAt: integer("visited_at").notNull(),
});
