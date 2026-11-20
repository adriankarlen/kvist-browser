import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite-plus";
import electron from "vite-plugin-electron/simple";

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
    jsPlugins: [
      { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
      { name: "anti-slop-effect", specifier: "./tools/oxlint/anti-slop/effect/index.ts" },
    ],
    rules: {
      "oxc/no-accumulating-spread": "error",
      "anti-slop/no-array-filter-map": "error",
      "anti-slop/no-reduce-accumulator-copy": "error",
      "anti-slop/require-readable-spacing": "error",
      "anti-slop-effect/no-manual-effect-error-tag": "error",
      "anti-slop-effect/no-manual-tag-comparison": "error",
      "anti-slop-effect/no-manual-tagged-construction": "error",
      "anti-slop-effect/no-service-constructor-imports": "error",
      "anti-slop-effect/prefer-effect-match": "error",
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
      "anti-slop/no-verbose-comments": "error",
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
          "anti-slop/no-unknown-returns": "off",
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
        // The omnibox query is the typed boundary for what an IPC query hands
        // main: `handleQueries` erases it to `unknown` at the transport seam,
        // and this is where it gets decoded back into a domain value.
        files: ["src/main/omnibox.ts"],
        rules: {
          "anti-slop/no-unknown-parameters": "off",
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
    // Two documents, because the completion menu paints in a
    // `WebContentsView` of its own — chrome HTML can never overlap a tab's
    // native layer, so a dropdown anchored to the omnibox needs a view that
    // sits above it.
    rollupOptions: {
      input: {
        index: "index.html",
        overlay: "overlay.html",
      },
    },
  },
  plugins: [
    svelte(),
    electron({
      main: {
        entry: "src/main/index.ts",
        vite: {
          build: {
            outDir: "dist/main",
            // The adblocker has a `require.resolve` that breaks once it
            // leaves its package directory. Effect is externalized as a
            // unit: a bundled copy and the one `@effect/*` resolves would
            // hold two service registries, and services would not be found.
            rolldownOptions: {
              external: ["@ghostery/adblocker-electron", "effect", /^effect\//, /^@effect\//],
            },
          },
        },
      },
      // index is the chrome's bridge; page runs in every tab and exposes
      // nothing; overlay backs the completion menu's own view.
      preload: [preload("index"), preload("page"), preload("overlay")],
    }),
  ],
});
