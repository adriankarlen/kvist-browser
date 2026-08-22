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
    jsPlugins: [{ name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" }],
    rules: {
      "anti-slop/no-chained-type-assertions": "error",
      "anti-slop/no-conditional-empty-object-spread": "error",
      "anti-slop/no-known-value-widening": "error",
      "anti-slop/no-module-mocking": "error",
      "anti-slop/no-object-parameters": "error",
      "anti-slop/no-reflect-apply": "error",
      "anti-slop/no-reflect-get": "error",
      "anti-slop/no-runtime-typeof": "error",
      "anti-slop/no-shape-in-symbol-names": "error",
      "anti-slop/no-unknown-parameters": "error",
      "anti-slop/no-unknown-returns": "error",
      "anti-slop/no-unknown-type-aliases": "error",
      "anti-slop/no-unsafe-dictionary-type": "error",
      "anti-slop/no-widen-then-assert": "error",
      "anti-slop/require-safety-comment-for-type-assertion": "error",
    },
  },
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
  },
  plugins: [
    svelte(),
    electron({
      main: {
        entry: "src/main/index.ts",
        vite: {
          build: {
            outDir: "dist/main",
            // The adblocker resolves its own preload with require.resolve at
            // runtime, which only works from inside its package directory.
            // Bundling it moves that call to dist/main, where pnpm's
            // non-hoisted layout cannot see the transitive dependency.
            rolldownOptions: { external: ["@ghostery/adblocker-electron"] },
          },
        },
      },
      // index is the chrome's bridge; page runs in every tab and exposes nothing.
      preload: [preload("index"), preload("page")],
    }),
  ],
});
