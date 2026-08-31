/**
 * The Drizzle schema barrel. Each table lives in its own file under
 * `./schema/<name>.ts` and is re-exported from here; the migrator reads this
 * file at generate time and the runtime reads it through `Database.open`.
 *
 * To add a table (KVI-25/26/27, the `Permissions` migration to disk, and
 * anything else that wants durable storage):
 *   1. Define the `sqliteTable(...)` in `src/main/db/schema/<name>.ts`.
 *   2. Re-export it from this file.
 *   3. Run `pnpm db:generate` to write the migration into `./migrations/`.
 *   4. Check the generated SQL in — it is the source of truth for what
 *      `Database.open` will apply.
 *
 * The schema is empty for now (KVI-24 is foundations only). The first table
 * ships with KVI-25 (history) or the `Permissions` migration, whichever lands
 * first.
 */
export {};
