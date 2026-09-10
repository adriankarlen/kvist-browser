import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit runs through Node directly, not the bundler, so this file is
 * a plain TS module loading at runtime. The migrator reads the same schema
 * from `src/main/db/schema.ts` via `database.ts`, keeping kit and runtime
 * aligned.
 */
export default defineConfig({
  schema: "./src/main/db/schema.ts",
  out: "./src/main/db/migrations",
  dialect: "sqlite",
  verbose: true,
});
