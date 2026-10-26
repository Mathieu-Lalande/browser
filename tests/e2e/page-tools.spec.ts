import type { ElectronApplication, Page } from "@playwright/test";
import { chromeOf, evalInTab, expect, launch, test } from "./fixtures";

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

async function visit(chrome: Page, url: string, title: string): Promise<void> {
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(url);
  await address.press("Enter");
  await expect(chrome.locator(".tab.active .title")).toHaveText(title);
}

/** Zoom factor of the tab page whose URL starts with `prefix`. */
const zoomOf = (app: ElectronApplication, prefix: string) =>
  app.evaluate(
    ({ webContents }, prefix) => webContents.getAllWebContents().find((c) => c.getURL().startsWith(prefix))?.getZoomFactor() ?? null,
    prefix,
  );

test("Ctrl+F finds the matches in the page, Enter and Shift+Enter move between them", async ({ app, chrome, server }) => {
  // Nothing to search on the start page.
  await press(app, "F");
  await expect(chrome.getByRole("search", { name: "Rechercher dans la page" })).toHaveCount(0);

  await visit(chrome, server.url("/find"), "Find");
  await press(app, "F");
  const input = chrome.getByRole("search", { name: "Rechercher dans la page" }).getByRole("textbox");
  await expect(input).toBeFocused();
  const count = chrome.getByTestId("find-count");

  await input.fill("renard");
  await expect(count).toHaveText("1/6");
  await input.press("Enter");
  await expect(count).toHaveText("2/6");
  await input.press("Enter");
  await expect(count).toHaveText("3/6");
  await input.press("Shift+Enter");
  await expect(count).toHaveText("2/6");

  // F3 (menu accelerator) steps too.
  await press(app, "F3", []);
  await expect(count).toHaveText("3/6");

  // Case-sensitive: "RENARD" no longer matches (the search goes on from the current match).
  await chrome.getByRole("button", { name: "Respecter la casse" }).click();
  await expect(count).toHaveText(/^\d\/5$/);
  await input.fill("introuvable");
  await expect(count).toHaveText("0/0");

  // Escape closes the bar; the query is kept for the tab.
  await input.fill("renard");
  await expect(count).toHaveText(/^\d\/5$/);
  await input.press("Escape");
  await expect(chrome.locator(".find-bar")).toHaveCount(0);

  // Another tab has its own (empty) find state; back on the first one, the query comes back.
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await visit(chrome, server.url("/other"), "Page other");
  await press(app, "F");
  await expect(input).toHaveValue("");
  await chrome.locator(".tabs [role=tab]", { hasText: "Find" }).click();
  await press(app, "F");
  await expect(input).toHaveValue("renard");
  await expect(count).toHaveText(/^\d\/5$/);
});

test("the zoom level is remembered per site, across tabs, navigations and restarts", async ({ profile, server }) => {
  let app = await launch(profile);
  let chrome = await chromeOf(app);
  await visit(chrome, server.url("/one"), "Page one");
  await press(app, "=");
  await press(app, "=");
  const indicator = (page: Page) => page.getByRole("button", { name: /^Zoom 125 %/ });
  await expect(indicator(chrome)).toBeVisible();
  expect(await zoomOf(app, server.url("/one"))).toBeCloseTo(1.25);

  // Same site in a new tab: same zoom.
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await visit(chrome, server.url("/two"), "Page two");
  await expect(indicator(chrome)).toBeVisible();
  expect(await zoomOf(app, server.url("/two"))).toBeCloseTo(1.25);

  // Another site keeps the default zoom.
  const other = server.url("/three").replace("127.0.0.1", "localhost");
  await visit(chrome, other, "Page three");
  await expect(chrome.getByRole("button", { name: /^Zoom / })).toHaveCount(0);
  expect(await zoomOf(app, other)).toBeCloseTo(1);
  await app.close();

  // After a restart, the site comes back zoomed; the indicator resets it.
  app = await launch(profile);
  try {
    chrome = await chromeOf(app);
    await visit(chrome, server.url("/four"), "Page four");
    await expect(indicator(chrome)).toBeVisible();
    await expect.poll(() => zoomOf(app, server.url("/four"))).toBeCloseTo(1.25);
    await indicator(chrome).click();
    await expect(chrome.getByRole("button", { name: /^Zoom / })).toHaveCount(0);
    await expect.poll(() => zoomOf(app, server.url("/four"))).toBeCloseTo(1);
  } finally {
    await app.close();
  }
});

test("muting a tab shows the sound indicator, which unmutes it", async ({ app, chrome, server }) => {
  await visit(chrome, server.url("/sound"), "Page sound");
  const isMuted = () =>
    app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find((c) => c.getURL() === url)?.isAudioMuted(), server.url("/sound"));

  // Ctrl+M (command "Couper le son de l'onglet").
  await press(app, "M");
  const unmute = chrome.locator(".tab.active").getByRole("button", { name: "Réactiver le son de l'onglet" });
  await expect(unmute).toBeVisible();
  expect(await isMuted()).toBe(true);

  await unmute.click();
  await expect.poll(isMuted).toBe(false);
  // Not playing anything: no indicator once unmuted.
  await expect(chrome.locator(".tab.active .audio")).toHaveCount(0);

  // A page that plays sound gets the indicator by itself.
  await evalInTab(
    app,
    server.url("/sound"),
    `(() => { const ctx = new AudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain();
      gain.gain.value = 0.2; osc.connect(gain).connect(ctx.destination); osc.start(); return ctx.resume(); })()`,
  );
  const mute = chrome.locator(".tab.active").getByRole("button", { name: "Couper le son de l'onglet" });
  await expect(mute).toBeVisible();
  await mute.click();
  await expect(unmute).toBeVisible();
  expect(await isMuted()).toBe(true);
});

test("in split view, find, zoom and mute act on the focused pane", async ({ app, chrome, server }) => {
  const findUrl = server.url("/find");
  const otherUrl = server.url("/other").replace("127.0.0.1", "localhost");
  await visit(chrome, otherUrl, "Page other");
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await visit(chrome, findUrl, "Find");
  const otherId = await chrome.evaluate<string>(
    `window.browser.getState().then((s) => s.tabs.find((t) => t.url === ${JSON.stringify(otherUrl)}).id)`,
  );
  await chrome.evaluate(`window.browser.split.open(${JSON.stringify(otherId)})`);
  await expect(chrome.locator(".split .pane")).toHaveCount(2);
  await expect(chrome.locator(".tab.active .title")).toHaveText("Find");
  const muted = (url: string) =>
    app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find((c) => c.getURL() === url)?.isAudioMuted(), url);

  await press(app, "F");
  const input = chrome.getByRole("search", { name: "Rechercher dans la page" }).getByRole("textbox");
  await input.fill("renard");
  await expect(chrome.getByTestId("find-count")).toHaveText("1/6");
  await input.press("Escape");

  await press(app, "=");
  await expect.poll(() => zoomOf(app, findUrl)).toBeCloseTo(1.1);
  expect(await zoomOf(app, otherUrl)).toBeCloseTo(1);
  await press(app, "M");
  await expect.poll(() => muted(findUrl)).toBe(true);
  expect(await muted(otherUrl)).toBe(false);

  // Focusing the other pane (a click on it) makes it the active tab: commands follow.
  await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find((c) => c.getURL() === url)!.focus(), otherUrl);
  await expect(chrome.locator(".tab.active .title")).toHaveText("Page other");
  await press(app, "M");
  await expect.poll(() => muted(otherUrl)).toBe(true);
  await press(app, "-");
  await expect.poll(() => zoomOf(app, otherUrl)).toBeCloseTo(0.9);
  expect(await zoomOf(app, findUrl)).toBeCloseTo(1.1);
});

test("the picture-in-picture command pops the page's video out, and back", async ({ app, chrome, server }) => {
  const url = server.url("/video");
  await visit(chrome, url, "Video");
  await expect.poll(() => evalInTab(app, url, `document.getElementById("v").readyState`)).toBeGreaterThan(0);
  const pipId = () => evalInTab<string | null>(app, url, `document.pictureInPictureElement?.id ?? null`);

  await chrome.evaluate(`window.browser.commands.run("picture-in-picture")`);
  await expect.poll(pipId).toBe("v");
  await chrome.evaluate(`window.browser.commands.run("picture-in-picture")`);
  await expect.poll(pipId).toBeNull();

  // Harmless where there is no video.
  await visit(chrome, server.url("/novideo"), "Page novideo");
  await chrome.evaluate(`window.browser.commands.run("picture-in-picture")`);
  expect(await evalInTab(app, server.url("/novideo"), "document.pictureInPictureElement")).toBeNull();
});
