/**
 * The schema barrel. To add a table: define the `sqliteTable` in
 * `schema/<name>.ts`, re-export it here, run `pnpm db:generate`, and check
 * the generated SQL in — it is what `Database.open` applies.
 */
export * from "./schema/bookmarks";
export * from "./schema/history";
export * from "./schema/session";
