import type { ElectronApplication, Page } from "@playwright/test";
import { chromeOf, expect, launch, tabUrls, test } from "./fixtures";

/** Native key press through the main process, so Electron menu accelerators fire (see library.spec.ts). */
async function press(app: ElectronApplication, keyCode: string, modifiers: ("control" | "shift")[] = ["control"]): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, { keyCode, modifiers }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      contents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      contents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    },
    { keyCode, modifiers },
  );
}

// String expressions: this file is type-checked without the DOM library.
const cssVar = (chrome: Page, name: string) =>
  chrome.evaluate<string>(`getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(name)}).trim()`);

async function visit(chrome: Page, url: string, title: string): Promise<void> {
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(url);
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText(title);
}

/** Bounds of the page view currently attached to the window, if any. */
const attachedBounds = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0]?.getBounds() ?? null);

test("the gear opens the settings in a tab, and the accent color applies live", async ({ chrome }) => {
  await chrome.getByRole("button", { name: "Paramètres" }).click();
  await expect(chrome.getByRole("heading", { name: "Paramètres", level: 1 })).toBeVisible();
  await expect(chrome.locator(".tab.active .title")).toHaveText("Paramètres");
  await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(2);
  await expect(chrome.getByLabel("Barre d'adresse")).toHaveValue("browser://settings");

  expect(await cssVar(chrome, "--accent")).toBe("#8b7bff");
  await chrome.getByRole("radio", { name: "Océan" }).click();
  await expect.poll(() => cssVar(chrome, "--accent")).toBe("#3b82f6");
  await expect.poll(() => cssVar(chrome, "--accent-2")).toBe("#22d3ee");

  // Opening the settings again reuses their tab.
  await chrome.locator(".tabs [role=tab]").first().click();
  await chrome.getByRole("button", { name: "Paramètres" }).click();
  await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(2);
  await expect(chrome.locator(".tab.active .title")).toHaveText("Paramètres");
});

test("settings persist across a restart, and the settings tab is restored", async ({ profile }) => {
  let app = await launch(profile);
  let chrome = await chromeOf(app);
  await press(app, ","); // Ctrl+, (menu accelerator)
  await expect(chrome.locator(".tab.active .title")).toHaveText("Paramètres");
  const hex = chrome.getByLabel("Couleur d'accent (hexadécimal)");
  await hex.fill("#ff5500");
  await chrome.getByRole("radio", { name: "Sombre" }).click();
  await chrome.getByLabel("Prénom").fill("Mathieu");
  await expect.poll(() => cssVar(chrome, "--accent")).toBe("#ff5500");
  await app.close();

  app = await launch(profile);
  try {
    chrome = await chromeOf(app);
    await expect(chrome.locator(".tab.active .title")).toHaveText("Paramètres");
    expect(await cssVar(chrome, "--accent")).toBe("#ff5500");
    expect(await chrome.evaluate<string>("document.documentElement.dataset.theme")).toBe("dark");
    // The native window background follows the theme (no white flash).
    const background = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor());
    expect(background.toLowerCase()).toBe((await cssVar(chrome, "--bg")).toLowerCase());
    await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
    await expect(chrome.locator(".start h1")).toContainText(", Mathieu.");
  } finally {
    await app.close();
  }
});

test("the previous session is not restored when that setting is off", async ({ profile }) => {
  const { writeFileSync } = await import("node:fs");
  const tab = (url: string) => ({ url, title: url, favicon: null, pinned: false });
  writeFileSync(
    `${profile}/session.json`,
    JSON.stringify({ version: 1, data: { windows: [{ tabs: [tab("https://a.example/"), tab("https://b.example/")], activeIndex: 1 }] } }),
  );
  writeFileSync(`${profile}/settings.json`, JSON.stringify({ version: 1, data: { behavior: { restoreSession: false } } }));
  const app = await launch(profile);
  try {
    const chrome = await chromeOf(app);
    await expect(chrome.locator(".start h1")).toBeVisible();
    await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test("the chosen search engine is used for typed queries",async ({ app, chrome }) => {
  await app.evaluate(({ session }) => {
    // Keep the test offline: answer search requests locally.
    session.defaultSession.protocol.handle("https", () => new Response("<title>Search</title>", { headers: { "content-type": "text/html" } }));
  });
  await chrome.getByRole("button", { name: "Paramètres" }).click();
  await chrome.getByRole("radio", { name: /Google/ }).click();
  await expect(chrome.getByRole("radio", { name: /Google/ })).toHaveAttribute("aria-checked", "true");

  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  const address = chrome.getByLabel("Barre d'adresse");
  await address.pressSequentially("hello world");
  await expect(chrome.getByRole("option").first()).toHaveText("Rechercher « hello world »");
  await address.press("Enter");
  await expect.poll(() => tabUrls(app)).toContain("https://www.google.com/search?q=hello%20world");
});

test("web pages cannot navigate to or open browser:// pages", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/internal-link"), "Internal link");
  await app.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url);
    return page?.executeJavaScript(
      `document.getElementById("link").click();
       document.getElementById("popup").click();
       window.open("browser://settings");
       location.href = "browser://settings";`,
      true,
    );
  }, server.url("/internal-link"));
  await new Promise((resolve) => setTimeout(resolve, 600));
  await expect(chrome.locator(".tabs [role=tab]")).toHaveCount(1);
  await expect(chrome.locator(".tab.active .title")).toHaveText("Internal link");
  await expect(chrome.locator(".settings")).toHaveCount(0);
  expect((await tabUrls(app)).some((url) => url.startsWith("browser:"))).toBe(false);

  // The user, however, can type it.
  await visit(chrome, "browser://settings", "Paramètres");
  await expect(chrome.locator(".settings")).toBeVisible();
  // Internal pages are drawn by the chrome UI: the page view is detached.
  await expect.poll(() => attachedBounds(app)).toBeNull();
});

test("zen mode hides the sidebar, which reappears from the window edge", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/zen"), "Page zen");
  const normal = await attachedBounds(app);
  expect(normal!.x).toBeGreaterThan(200);

  await press(app, "B", ["control", "shift"]);
  await expect(chrome.locator(".sidebar")).toHaveCount(0);
  const edge = chrome.getByTestId("zen-edge");
  await expect(edge).toBeVisible();
  // Edge to edge, but for the thin strip that lets the chrome UI see the pointer.
  await expect.poll(async () => (await attachedBounds(app))?.x).toBe(6);
  expect((await attachedBounds(app))!.y).toBe(0);

  // Raw mouse moves: the strip is replaced by the sidebar as soon as it is entered.
  const strip = (await edge.boundingBox())!;
  await chrome.mouse.move(600, 400);
  await chrome.mouse.move(strip.x + strip.width / 2, strip.y + 300);
  await expect(chrome.locator(".sidebar")).toBeVisible();
  // It stays while the pointer is on it, and hides once the pointer goes back to the page.
  await chrome.mouse.move(120, 300);
  await chrome.waitForTimeout(1200);
  await expect(chrome.locator(".sidebar")).toBeVisible();
  await chrome.mouse.move(900, 400);
  await expect(chrome.locator(".sidebar")).toHaveCount(0);

  // Ctrl+S still toggles the sidebar.
  await press(app, "S");
  await expect(chrome.locator(".sidebar")).toBeVisible();
  await press(app, "S");
  await expect(chrome.locator(".sidebar")).toHaveCount(0);

  await press(app, "B", ["control", "shift"]);
  await expect(chrome.locator(".sidebar")).toBeVisible();
  await expect.poll(async () => (await attachedBounds(app))?.x).toBe(normal!.x);
});

test("the sidebar can move to the right and be resized by dragging its edge", async ({ chrome }) => {
  await chrome.getByRole("button", { name: "Paramètres" }).click();
  await chrome.getByRole("radio", { name: "Droite" }).click();
  const sidebar = chrome.locator(".sidebar");
  await expect.poll(async () => (await sidebar.boundingBox())!.x).toBeGreaterThan(600);

  await chrome.getByRole("radio", { name: "Gauche" }).click();
  const handle = chrome.getByRole("separator", { name: "Largeur de la barre latérale" });
  const box = (await handle.boundingBox())!;
  await chrome.mouse.move(box.x + box.width / 2, box.y + 200);
  await chrome.mouse.down();
  await chrome.mouse.move(box.x + 80, box.y + 200, { steps: 5 });
  await chrome.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", "340");
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(340);
});
