import type { Page } from "@playwright/test";
import { chromeOf, expect, launch, test } from "./fixtures";

// String expressions: this file is type-checked without the DOM library.
const cssVar = (chrome: Page, name: string) =>
  chrome.evaluate<string>(`getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(name)}).trim()`);

async function openSettings(chrome: Page): Promise<void> {
  await chrome.getByRole("button", { name: "Paramètres", exact: true }).click();
  await expect(chrome.getByRole("heading", { name: "Paramètres", level: 1 })).toBeVisible();
}

test("a theme exported as a code imports back with a preview, and the gallery applies themes", async ({ chrome }) => {
  await openSettings(chrome);
  // Gallery: "Terminal" (mono font, green accent).
  await chrome.getByRole("group", { name: "Galerie de thèmes" }).getByRole("button", { name: "Terminal" }).click();
  await expect.poll(() => cssVar(chrome, "--accent")).toBe("#22c55e");
  await expect(chrome.getByRole("button", { name: "Terminal" })).toHaveAttribute("aria-pressed", "true");
  const code = await chrome.getByLabel("Code du thème", { exact: true }).inputValue();
  expect(code).toMatch(/^browser-theme:v1:[\w-]+$/);

  // Another theme, then the code brings "Terminal" back after the preview's "Appliquer".
  await chrome.getByRole("button", { name: "Papier" }).click();
  await expect.poll(() => cssVar(chrome, "--accent")).not.toBe("#22c55e");
  const field = chrome.getByLabel("Code de thème à importer");
  await field.fill("browser-theme:v1:garbage!");
  await chrome.getByRole("button", { name: "Aperçu" }).click();
  await expect(chrome.getByRole("alert")).toContainText("illisible");
  await field.fill(code);
  await chrome.getByRole("button", { name: "Aperçu" }).click();
  const preview = chrome.getByRole("group", { name: "Aperçu du thème importé" });
  await expect(preview).toBeVisible();
  // Nothing changes before "Appliquer"; "Annuler" drops the preview.
  expect(await cssVar(chrome, "--accent")).not.toBe("#22c55e");
  await preview.getByRole("button", { name: "Annuler" }).click();
  await expect(preview).toBeHidden();
  await field.fill(code);
  await chrome.getByRole("button", { name: "Aperçu" }).click();
  await preview.getByRole("button", { name: "Appliquer" }).click();
  await expect.poll(() => cssVar(chrome, "--accent")).toBe("#22c55e");
  await expect.poll(() => cssVar(chrome, "--font")).toContain("monospace");
});

test("a .browsertheme file round-trips through export and import", async ({ app, chrome, profile }) => {
  const file = `${profile}/mine.browsertheme`;
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as unknown as typeof dialog.showSaveDialog;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as unknown as typeof dialog.showOpenDialog;
  }, file);
  await openSettings(chrome);
  await chrome.getByRole("button", { name: "Nuit polaire" }).click();
  await expect.poll(() => cssVar(chrome, "--accent")).toBe("#38bdf8");
  await chrome.getByRole("button", { name: "Exporter un fichier…" }).click();
  await expect(chrome.getByRole("button", { name: "Exporté" })).toBeVisible();
  await chrome.getByRole("button", { name: "Encre" }).click();
  await expect.poll(() => cssVar(chrome, "--accent")).not.toBe("#38bdf8");
  await chrome.getByRole("button", { name: "Depuis un fichier…" }).click();
  await chrome.getByRole("group", { name: "Aperçu du thème importé" }).getByRole("button", { name: "Appliquer" }).click();
  await expect.poll(() => cssVar(chrome, "--accent")).toBe("#38bdf8");
});

test("the update status follows the fake updater, and the sidebar offers the restart", async ({ profile }) => {
  const app = await launch(profile, { BROWSER_TEST_UPDATER: "available" });
  try {
    const chrome = await chromeOf(app);
    await openSettings(chrome);
    const status = chrome.locator(".status[role=status]");
    await expect(status).toContainText("Pas encore vérifié");
    await expect(chrome.getByRole("button", { name: "Redémarrer pour mettre à jour" })).toHaveCount(0);
    await chrome.getByRole("button", { name: "Rechercher des mises à jour" }).click();
    await expect(status).toContainText("Téléchargement de la version 99.0.0");
    await expect(status).toContainText("Version 99.0.0 prête : redémarrez pour l'installer.");
    await expect(chrome.getByText(/Dernière vérification :/)).toBeVisible();
    await expect(chrome.getByRole("button", { name: "Redémarrer pour installer" })).toBeVisible();
    await expect(chrome.getByRole("button", { name: "Redémarrer pour mettre à jour" })).toBeVisible();
    // The menu offers it too.
    const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.flatMap((item) => item.submenu?.items.map((sub) => sub.label) ?? []));
    expect(labels).toContain("Redémarrer pour mettre à jour");
  } finally {
    await app.close();
  }
});

test("without automatic download the update waits; a manual-only install links to the release", async ({ profile }) => {
  let app = await launch(profile, { BROWSER_TEST_UPDATER: "available" });
  try {
    let chrome = await chromeOf(app);
    await openSettings(chrome);
    await chrome.getByRole("switch", { name: "Téléchargement automatique" }).click();
    await chrome.getByRole("button", { name: "Rechercher des mises à jour" }).click();
    const status = chrome.locator(".status[role=status]");
    await expect(status).toContainText("Version 99.0.0 disponible.");
    await chrome.getByRole("button", { name: "Télécharger", exact: true }).click();
    await expect(status).toContainText("prête");
    await app.close();

    app = await launch(profile, { BROWSER_TEST_UPDATER: "manual" });
    chrome = await chromeOf(app);
    await openSettings(chrome);
    await chrome.getByRole("button", { name: "Rechercher des mises à jour" }).click();
    await expect(chrome.locator(".status[role=status]")).toContainText("mise à jour manuelle requise");
    await expect(chrome.getByRole("button", { name: /Mise à jour manuelle requise/ })).toBeVisible();
  } finally {
    await app.close();
  }
});

test("updates are off in development without the fake updater", async ({ chrome }) => {
  await openSettings(chrome);
  await expect(chrome.locator(".status[role=status]")).toContainText("indisponibles");
  await expect(chrome.getByRole("button", { name: "Rechercher des mises à jour" })).toBeDisabled();
});
