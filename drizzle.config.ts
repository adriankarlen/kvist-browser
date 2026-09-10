import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit runs through Node directly. `defineConfig.schema` points
 * directly to `src/main/db/schema.ts`, while `database.ts` opens the
 * runtime connection and runtime consumers import the same schema barrel.
 */
export default defineConfig({
  schema: "./src/main/db/schema.ts",
  out: "./src/main/db/migrations",
  dialect: "sqlite",
  verbose: true,
});
