import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config — only used at dev time by `pnpm db:generate` and
 * `pnpm db:check`. The runtime migrator lives in `src/main/db/database.ts`
 * and reads the generated SQL out of `src/main/db/migrations/`.
 *
 * Drizzle Kit runs through Node directly, not through the bundler, so this
 * file is a plain TS module that gets JIT'd by drizzle-kit's own loader.
 * The 1.0 RC aligns the runtime and the kit, so the schema entry referenced
 * here is the same one the runtime reads.
 */
export default defineConfig({
  schema: "./src/main/db/schema.ts",
  out: "./src/main/db/migrations",
  dialect: "sqlite",
  verbose: true,
});
