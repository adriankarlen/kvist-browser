import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * One row per bookmark. Two rows for the same URL are intentional: a user can
 * save the same page under more than one name, and any "did you mean to
 * bookmark this twice?" question is a UI concern, not a storage one — the
 * writer never has to reach past `add` to find out.
 *
 * No `origin` denormalization the way `history` carries one: bookmarks are
 * keyed by URL and named by the user at the moment of save, so the URL is
 * already the row's identity and an `originOf`-style projection would be a
 * stored copy of something the URL already says.
 */
export const bookmarks = sqliteTable("bookmarks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  url: text("url").notNull(),
  title: text("title").notNull(),
  createdAt: integer("created_at").notNull(),
});
