import { cpSync } from "node:fs";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite-plus";
import electron from "vite-plugin-electron/simple";

/**
 * Copies a directory tree to the build output. Used to ship the Drizzle
 * migrations folder alongside the main bundle; the runtime migrator reads
 * from `import.meta.url`-relative paths that resolve to `dist/main/migrations`
 * in a packaged build and to `src/main/db/migrations` in dev.
 */
function copyDir(from: string, to: string): void {
  cpSync(from, to, { recursive: true });
}

/**
 * Each preload is built on its own: the plugin bundles a preload to a single
 * file, which rules out sharing one build across several entries.
 */
function preload(name: string) {
  return {
    input: `src/preload/${name}.ts`,
    vite: {
      build: {
        outDir: "dist/preload",
        // Entries land in one directory, so a later build must not wipe the
        // output of an earlier one.
        emptyOutDir: false,
        // The plugin emits CommonJS but names it .mjs when the package is
        // type: module, which Electron then refuses to load as ESM.
        rolldownOptions: { output: { entryFileNames: "[name].cjs" } },
      },
    },
  };
}

export default defineConfig({
  fmt: {
    ignorePatterns: [
      ".agent/**",
      ".agents/**",
      ".claude/**",
      ".codex/**",
      ".continue/**",
      ".cursor/**",
      ".gemini/**",
      ".opencode/**",
      ".pi/**",
      ".roo/**",
      ".windsurf/**",
      "tools/oxlint/anti-slop/**",
    ],
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
    ignorePatterns: [
      ".agent/**",
      ".agents/**",
      ".claude/**",
      ".codex/**",
      ".continue/**",
      ".cursor/**",
      ".gemini/**",
      ".opencode/**",
      ".pi/**",
      ".roo/**",
      ".windsurf/**",
      "tools/oxlint/anti-slop/**",
    ],
    jsPlugins: [{ name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" }],
    rules: {
      "anti-slop/no-chained-type-assertions": "error",
      "anti-slop/no-conditional-empty-object-spread": "error",
      "anti-slop/no-known-value-widening": "error",
      "anti-slop/no-module-mocking": "error",
      "anti-slop/no-object-parameters": "error",
      "anti-slop/no-reflect-apply": "error",
      "anti-slop/no-reflect-get": "error",
      "anti-slop/no-runtime-typeof": ["error", { allowInTypeGuards: true }],
      "anti-slop/no-shape-in-symbol-names": "error",
      "anti-slop/no-unknown-parameters": "error",
      "anti-slop/no-unknown-returns": "error",
      "anti-slop/no-unknown-type-aliases": "error",
      "anti-slop/no-unsafe-dictionary-type": "error",
      "anti-slop/no-widen-then-assert": "error",
      "anti-slop/require-safety-comment-for-type-assertion": "error",
    },
    overrides: [
      {
        // The typed IPC seam: a channel table erases to `unknown` exactly here,
        // at the transport boundary, so both sides stay typed from one table.
        files: ["src/shared/ipc.ts", "src/main/ipc.ts", "src/preload/**"],
        rules: {
          "anti-slop/no-chained-type-assertions": "off",
          "anti-slop/no-known-value-widening": "off",
          "anti-slop/no-unknown-parameters": "off",
        },
      },
      {
        // The config.toml parser is the boundary decoder these rules ask for;
        // its inputs are `unknown` and its intermediate tables open by nature.
        files: ["src/main/settings.ts", "src/main/index.ts", "src/main/zoom.ts"],
        rules: {
          "anti-slop/no-unknown-parameters": "off",
          "anti-slop/no-unsafe-dictionary-type": "off",
        },
      },
      {
        // The validation utility is the typed boundary for ArkType: callers
        // hand it `unknown` precisely so it can decode, and the field-path
        // builder has to look at runtime segment shapes.
        files: ["src/main/db/validation.ts"],
        rules: {
          "anti-slop/no-unknown-parameters": "off",
          "anti-slop/no-unsafe-dictionary-type": "off",
        },
      },
      {
        // Tests stub seams with partial fakes; the casts stay SAFETY-commented.
        files: ["**/*.test.ts"],
        rules: {
          "anti-slop/no-chained-type-assertions": "off",
          "anti-slop/no-unknown-parameters": "off",
          "anti-slop/no-unknown-returns": "off",
          "anti-slop/no-unsafe-dictionary-type": "off",
          "anti-slop/no-known-value-widening": "off",
        },
      },
    ],
  },
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
  },
  plugins: [
    svelte(),
    // Copies `src/main/db/migrations/` into `dist/main/migrations/` after the
    // main bundle builds. The runtime migrator reads from there (the same
    // `import.meta.url`-relative path it uses in dev), and the bundle
    // itself stays free of the SQL — the contents change with the schema,
    // not with the code that runs them.
    {
      name: "kvist-db-migrations",
      apply: "build",
      enforce: "post",
      closeBundle: {
        order: "pre",
        handler() {
          return copyDir("src/main/db/migrations", "dist/main/migrations");
        },
      },
    },
    electron({
      main: {
        entry: "src/main/index.ts",
        vite: {
          build: {
            outDir: "dist/main",
            // Each entry below resolves at runtime rather than through the
            // bundler: the adblocker has a `require.resolve` that breaks once
            // it leaves its package directory, and the Drizzle / node-sqlite
            // stack is pinned to a 1.0 RC line where letting the bundler pick
            // a version would silently shadow the lockfile. Node's built-in
            // `node:sqlite` is auto-externalized by the plugin.
            rolldownOptions: {
              external: [
                "@ghostery/adblocker-electron",
                "drizzle-orm",
                "drizzle-orm/node-sqlite",
                "drizzle-orm/node-sqlite/migrator",
                "drizzle-arktype",
              ],
            },
          },
        },
      },
      // index is the chrome's bridge; page runs in every tab and exposes nothing.
      preload: [preload("index"), preload("page")],
    }),
  ],
});
