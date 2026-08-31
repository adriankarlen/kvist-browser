import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit runs through Node directly, not the bundler, so this file
 * is a plain TS module that gets JIT'd by drizzle-kit's own loader. The
 * runtime migrator reads the same schema from `src/main/db/schema.ts`
 * via `database.ts`, so the kit and the runtime are aligned.
 */
export default defineConfig({
  schema: "./src/main/db/schema.ts",
  out: "./src/main/db/migrations",
  dialect: "sqlite",
  verbose: true,
});
