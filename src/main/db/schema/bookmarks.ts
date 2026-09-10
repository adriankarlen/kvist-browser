import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * One row per bookmark; two rows for one URL are intentional — a page may
 * sit under several names, and "did you mean twice?" is a UI question, not
 * a storage one.
 *
 * No `origin` column: the URL already is the identity.
 */
export const bookmarks = sqliteTable("bookmarks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  url: text("url").notNull(),
  title: text("title").notNull(),
  createdAt: integer("created_at").notNull(),
});
