import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite-plus";
import electron from "vite-plugin-electron/simple";

export default defineConfig({
  fmt: {
    ignorePatterns: [],
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
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
        vite: { build: { outDir: "dist/main" } },
      },
      preload: {
        input: "src/preload/index.ts",
        vite: {
          build: {
            outDir: "dist/preload",
            // The plugin emits CommonJS but names it .mjs when the package is
            // type: module, which Electron then refuses to load as ESM.
            rolldownOptions: { output: { entryFileNames: "[name].cjs" } },
          },
        },
      },
    }),
  ],
});
