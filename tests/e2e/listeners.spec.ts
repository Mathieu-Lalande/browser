import { expect, test, visit } from "./fixtures";

// Every feature's isolated-world script waits for the page to finish loading: a normal page load
// must not trip Node's MaxListenersExceededWarning (it read as a memory leak in the dev console).
test("loading pages raises no MaxListenersExceededWarning", async ({ app, chrome, server }) => {
  await app.evaluate(() => {
    const store = globalThis as unknown as { warnings: string[] };
    store.warnings = [];
    process.on("warning", (warning) => store.warnings.push(warning.name));
  });
  await visit(chrome, server.url("/other"), "Page other");
  for (let i = 0; i < 3; i++) await visit(chrome, server.url("/find"), "Find");
  const warnings = await app.evaluate(() => (globalThis as unknown as { warnings: string[] }).warnings);
  expect(warnings).not.toContain("MaxListenersExceededWarning");
});
