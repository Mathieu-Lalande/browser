import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const shared = { "@shared": resolve(import.meta.dirname, "src/shared") };

export default defineConfig({
  main: {
    resolve: { alias: shared },
  },
  preload: {
    resolve: { alias: shared },
    build: {
      rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } },
    },
  },
  renderer: {
    root: "src/renderer",
    resolve: { alias: shared },
    plugins: [svelte({ configFile: resolve(import.meta.dirname, "svelte.config.js") })],
    build: {
      rollupOptions: { input: { index: resolve(import.meta.dirname, "src/renderer/index.html") } },
    },
  },
});
