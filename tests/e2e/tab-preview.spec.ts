import type { ElectronApplication, Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import { accentVariables, contrastRatio, parseHex } from "@shared/theme";
import { expect, overlayOf, test, visit } from "./fixtures";

// Tab hover preview and dynamic theme (ADR-038).

type Global = { browser: BrowserApi };

/** The overlay view's bounds while attached, null when detached. */
const overlayBounds = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const view = window.contentView.children.find((child) => "webContents" in child && (child as Electron.WebContentsView).webContents.getURL().endsWith("overlay.html"));
    return view ? view.getBounds() : null;
  });

// String expression: this file is type-checked without the DOM library.
const shellVar = (chrome: Page, name: string) => chrome.evaluate<string>(`getComputedStyle(document.querySelector(".shell")).getPropertyValue(${JSON.stringify(name)}).trim()`);
const rootVar = (chrome: Page, name: string) => chrome.evaluate<string>(`getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(name)}).trim()`);

test("hovering a tab shows its preview card beside the row, moves between rows and hides on leave", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/alpha"), "Page alpha");
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await visit(chrome, server.url("/beta"), "Page beta");
  const overlay = await overlayOf(app);

  const alpha = chrome.locator(".tabs [role=tab]", { hasText: "Page alpha" });
  const beta = chrome.locator(".tabs [role=tab]", { hasText: "Page beta" });
  await alpha.hover();
  await expect(overlay.getByTestId("tab-preview-title")).toHaveText("Page alpha");
  await expect(overlay.getByTestId("tab-preview")).toContainText("127.0.0.1");

  // A card no larger than itself, right of the row: the sidebar keeps the pointer.
  const row = (await alpha.boundingBox())!;
  const bounds = (await overlayBounds(app))!;
  expect(bounds.x).toBeGreaterThan(row.x + row.width - 20);
  expect(bounds.width).toBeLessThan(400);
  // The chrome UI keeps the focus.
  expect(await chrome.evaluate<boolean>("document.hasFocus()")).toBe(true);

  // Moving to the next row updates the same card; the visible tab gets a live thumbnail.
  await beta.hover();
  await expect(overlay.getByTestId("tab-preview-title")).toHaveText("Page beta");
  await expect(overlay.locator("img.thumbnail")).toHaveAttribute("src", /^data:image\/jpeg;base64,/);

  // Leaving the rows hides it.
  await chrome.getByRole("button", { name: "Nouvel onglet" }).first().hover();
  await expect.poll(() => overlayBounds(app)).toBeNull();

  // Off in the settings: no card.
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.settings.update({ layout: { tabHoverPreview: false } }));
  await alpha.hover();
  await chrome.waitForTimeout(700);
  expect(await overlayBounds(app)).toBeNull();
});

test("the dynamic theme follows the page's theme-color, through the contrast engine", async ({ chrome, server }) => {
  const themeAccent = await rootVar(chrome, "--accent");
  await chrome.evaluate(() => (globalThis as unknown as Global).browser.settings.update({ appearance: { dynamicTheme: true } }));
  await visit(chrome, server.url("/theme-color"), "Themed");

  const mode = (await chrome.evaluate<string>("document.documentElement.dataset.theme")) as "light" | "dark";
  const expected = accentVariables("#e11d48", mode);
  await expect.poll(() => shellVar(chrome, "--accent")).toBe(expected["--accent"]);
  await expect.poll(() => shellVar(chrome, "--accent-text")).toBe(expected["--accent-text"]);
  // Accent text stays AA on the window background.
  const bg = parseHex(await rootVar(chrome, "--bg"))!;
  expect(contrastRatio(parseHex(await shellVar(chrome, "--accent-text"))!, bg)).toBeGreaterThanOrEqual(4.5);

  // A page without one: back to the theme (no space color).
  await visit(chrome, server.url("/plain"), "Page plain");
  await expect.poll(() => shellVar(chrome, "--accent")).toBe(themeAccent);
});
