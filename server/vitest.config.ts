import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  oxc: {
    tsconfig: "./tsconfig.json",
  },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
