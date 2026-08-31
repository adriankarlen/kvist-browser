/**
 * The Drizzle schema barrel. To add a table:
 *   1. Define the `sqliteTable(...)` in `src/main/db/schema/<name>.ts`.
 *   2. Re-export it from this file.
 *   3. Run `pnpm db:generate` to write the migration into `./migrations/`.
 *   4. Check the generated SQL in — it is the source of truth for what
 *      `Database.open` will apply.
 */
export {};
