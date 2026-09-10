import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * One row per committed main-frame navigation; a reload is its own row —
 * fresher than upserting on URL, closer to Chrome. In-page navigations and
 * failed loads are filtered.
 *
 * `origin` is denormalized so per-site queries skip reparsing, nullable for
 * unremembered origins.
 */
export const history = sqliteTable("history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  url: text("url").notNull(),
  title: text("title").notNull(),
  origin: text("origin"),
  visitedAt: integer("visited_at").notNull(),
});
