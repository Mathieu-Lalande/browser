import { resolve } from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Compiles the runes of the interface's `.svelte.ts` modules (controllers tested without a DOM).
  plugins: [svelte({ configFile: resolve(import.meta.dirname, "svelte.config.js") })],
  resolve: { alias: { "@shared": resolve(import.meta.dirname, "src/shared") } },
  test: { include: ["src/**/*.test.ts", "scripts/**/*.test.ts"], environment: "node" },
});
