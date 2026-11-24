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
        // The RPC transport: a port carries protocol messages that are
        // `unknown` until the RPC layer decodes them with the group's schemas.
        files: ["src/shared/rpc/**"],
        rules: {
          "anti-slop/no-unknown-parameters": "off",
          "anti-slop/no-unknown-returns": "off",
        },
      },
      {
        // The config.toml parser is the boundary decoder these rules ask for;
        // its inputs are `unknown` and its intermediate tables open by nature.
        files: ["src/main/settings.ts"],
        rules: {
          "anti-slop/no-unknown-parameters": "off",
          "anti-slop/no-unsafe-dictionary-type": "off",
        },
      },
      {
        // The validation utility is the typed boundary for Schema: callers
        // hand it `unknown` precisely so it can decode, and the field-path
        // builder has to look at runtime segment shapes.
        files: ["src/main/db/validation.ts"],
        rules: {
          "anti-slop/no-unknown-parameters": "off",
          "anti-slop/no-unsafe-dictionary-type": "off",
        },
      },
      {
        // A program decides; it never does. No runtime, no platform, no
        // services: only the pure modules of Effect. See docs/architecture.md.
        files: ["src/**/*.program.ts"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              paths: [
                {
                  name: "effect",
                  importNames: [
                    "Effect",
                    "Stream",
                    "Layer",
                    "Fiber",
                    "ManagedRuntime",
                    "Queue",
                    "PubSub",
                    "Context",
                  ],
                  message: "A program is pure: return Cmds and let an interpreter run them.",
                },
                { name: "electron", message: "A program never touches Electron." },
                { name: "svelte", message: "A program never touches the view." },
              ],
              patterns: [
                { group: ["node:*"], message: "A program never touches the platform." },
                { group: ["**/services/**"], message: "Programs never yield services." },
              ],
            },
          ],
        },
      },
      {
        // Time and logging go through Effect, so tests control them and one
        // logger sees everything. The kernel is where Effect meets the loop.
        files: ["src/**/*.ts"],
        excludeFiles: ["src/shared/tea/**", "**/*.test.ts"],
        rules: {
          "no-restricted-globals": [
            "error",
            { name: "setTimeout", message: "Use Effect.sleep, Schedule or a keyed Cmd." },
            { name: "setInterval", message: "Use Schedule or Stream." },
            { name: "console", message: "Use Effect.log*." },
          ],
          "no-restricted-imports": [
            "error",
            {
              paths: [
                { name: "node:fs", message: "Use FileSystem from effect." },
                { name: "node:fs/promises", message: "Use FileSystem from effect." },
              ],
            },
          ],
        },
      },
      {
        // `will-download` must pick the save path before it returns, so the
        // reservation check there is a synchronous file system call.
        files: ["src/main/services/downloads-gate.ts"],
        rules: { "no-restricted-imports": "off" },
      },
      {
        // Components read the model and dispatch; the client is the store's.
        files: [
          "src/renderer/**/*.svelte",
          "src/overlay/**/*.svelte",
          "src/palette/**/*.svelte",
          "src/shared/**/*.svelte",
        ],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                { group: ["**/rpc/**"], message: "Dispatch a Msg; components never call RPC." },
              ],
            },
          ],
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
    // Keeps light-dark() native. The polyfill for older targets only hears
    // color-scheme from our own sheets, so config.css could not switch it.
    cssTarget: "chrome123",
    // Three documents: chrome HTML can never overlap a tab's native layer,
    // so the completion menu and the command palette each paint in a
    // `WebContentsView` of their own above it.
    rollupOptions: {
      input: {
        index: "index.html",
        overlay: "overlay.html",
        palette: "palette.html",
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
      // nothing; overlay and palette back their own views.
      preload: [preload("index"), preload("page"), preload("overlay"), preload("palette")],
    }),
  ],
});
