import type { BrowserApi } from "@shared/ipc";
import { expect, test } from "./fixtures";

type Window = { browser: BrowserApi };
const LONG = "un-titre-de-page-vraiment-tres-long-qui-ne-tient-jamais-dans-la-barre-laterale";

async function open(chrome: import("@playwright/test").Page, url: string) {
  const address = chrome.getByLabel("Barre d'adresse");
  await address.fill(url);
  await address.press("Enter");
}

test("close buttons keep their size on the narrowest sidebar, split tabs included", async ({ chrome, server }) => {
  await chrome.evaluate(() => (globalThis as unknown as Window).browser.settings.update({ layout: { sidebarWidth: 200 } }));
  await open(chrome, server.url(`/${LONG}`));
  await expect(chrome.locator(".tab.active .title")).toHaveText(`Page ${LONG}`);

  const close = chrome.locator(".tabs .tab.active .close");
  await expect(close).toBeVisible();
  expect((await close.boundingBox())!.width).toBeGreaterThanOrEqual(22);

  // Two long tabs side by side in a split pill: each still has its close button.
  await chrome.getByRole("button", { name: "Nouvel onglet" }).click();
  await open(chrome, server.url(`/${LONG}-2`));
  await expect(chrome.locator(".tab.active .title")).toHaveText(`Page ${LONG}-2`);
  const first = await chrome.evaluate(async () => (await (globalThis as unknown as Window).browser.getState())!.tabs[0].id);
  await chrome.evaluate((id) => (globalThis as unknown as Window).browser.split.open(id), first);
  const members = chrome.locator(".split-group [role=tab]");
  await expect(members).toHaveCount(2);
  for (const member of await members.all()) {
    await member.hover();
    const button = member.locator(".close");
    await expect(button).toBeVisible();
    expect((await button.boundingBox())!.width).toBeGreaterThanOrEqual(18);
  }
});
