import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

type Modifier = "control" | "shift" | "alt";

/** Native key press through the main process, so Electron menu accelerators fire (see library.spec.ts). */
async function press(app: ElectronApplication, keyCode: string, modifiers: Modifier[] = ["control"]): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, { keyCode, modifiers }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      contents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      contents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    },
    { keyCode, modifiers },
  );
}

/** Accelerator of the visible application menu item labelled `label`. */
const menuAccelerator = (app: ElectronApplication, label: string) =>
  app.evaluate(({ Menu }, label) => {
    const walk = (items: Electron.MenuItem[]): string | null | undefined => {
      for (const item of items) {
        if (item.label === label && item.visible) return item.accelerator ?? null;
        const found = item.submenu && walk(item.submenu.items);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    return walk(Menu.getApplicationMenu()?.items ?? []);
  }, label);

async function openShortcuts(app: ElectronApplication, chrome: Page) {
  await press(app, ","); // Ctrl+, opens the settings, in the (reused) start-page tab.
  await expect(chrome.locator(".tab.active .title")).toHaveText("Paramètres");
  await chrome.getByRole("navigation", { name: "Sections des paramètres" }).getByRole("button", { name: "Raccourcis clavier" }).click();
  return chrome.locator("section#shortcuts");
}

/** The button showing (and capturing) a command's shortcut. */
const keysOf = (section: Locator, id: string) =>
  section.locator(`[data-command="${id}"]`).getByRole("button", { name: "Modifier le raccourci" });

test("a command rebound in the settings answers its new shortcut only", async ({ app, chrome }) => {
  const section = await openShortcuts(app, chrome);
  const tabs = chrome.locator(".tabs [role=tab]");
  await expect(tabs).toHaveCount(1);

  const newTab = keysOf(section, "new-tab");
  await expect(newTab).toHaveText("CtrlT");
  await newTab.click();
  await expect(newTab).toHaveText("Appuyez sur la combinaison…");
  // Captured: the menu's Ctrl+T must not fire meanwhile, nor a bare key be accepted.
  await press(app, "A", []);
  await expect(section.getByRole("status")).toContainText("Ajoutez Ctrl ou Alt");
  await press(app, "Y", ["control", "shift"]);
  await expect(newTab).toHaveText("CtrlMajY");
  await expect(section.locator(`[data-command="new-tab"]`).getByRole("button", { name: "Rétablir le raccourci par défaut" })).toBeVisible();
  await expect.poll(() => menuAccelerator(app, "Nouvel onglet")).toBe("Ctrl+Shift+Y");

  // The old combination does nothing any more; the new one opens a tab.
  await press(app, "T");
  await chrome.waitForTimeout(300);
  await expect(tabs).toHaveCount(1);
  await press(app, "Y", ["control", "shift"]);
  await expect(tabs).toHaveCount(2);
  await expect(chrome.locator(".tab.active .title")).not.toHaveText("Paramètres");

  // Tooltips follow the user's shortcut too.
  await expect(chrome.getByRole("button", { name: "Nouvel onglet" }).first()).toHaveAttribute("title", /Ctrl\+Maj\+Y/);
});

test("choosing a combination already in use asks before taking it", async ({ app, chrome }) => {
  const section = await openShortcuts(app, chrome);
  const newTab = keysOf(section, "new-tab");
  const newWindow = keysOf(section, "new-window");

  await newTab.click();
  await press(app, "N");
  const alert = section.getByRole("alert");
  await expect(alert).toContainText("Ctrl+N est déjà utilisé par « Nouvelle fenêtre »");
  await alert.getByRole("button", { name: "Annuler" }).click();
  await expect(alert).toHaveCount(0);
  await expect(newTab).toHaveText("CtrlT");
  await expect(newWindow).toHaveText("CtrlN");

  await newTab.click();
  await press(app, "N");
  await section.getByRole("alert").getByRole("button", { name: "Remplacer" }).click();
  await expect(newTab).toHaveText("CtrlN");
  await expect(newWindow).toHaveText("Aucun");
  await expect.poll(() => menuAccelerator(app, "Nouvel onglet")).toBe("Ctrl+N");
  await expect.poll(() => menuAccelerator(app, "Nouvelle fenêtre")).toBeNull();

  // Backspace removes a shortcut; Escape cancels; the row reset brings the default back.
  await newTab.click();
  await press(app, "Backspace", []);
  await expect(newTab).toHaveText("Aucun");
  await newWindow.click();
  await press(app, "Escape", []);
  await expect(newWindow).toHaveText("Aucun");
  await section.locator(`[data-command="new-tab"]`).getByRole("button", { name: "Rétablir le raccourci par défaut" }).click();
  await expect(newTab).toHaveText("CtrlT");

  // Search, then reset everything.
  await section.getByRole("searchbox", { name: "Rechercher un raccourci" }).fill("fenetre");
  await expect(section.getByRole("button", { name: "Modifier le raccourci" })).toHaveCount(2); // Nouvelle fenêtre (privée)
  await section.getByRole("button", { name: "Tout réinitialiser" }).click();
  await section.getByRole("button", { name: "Réinitialiser", exact: true }).click();
  await expect(newWindow).toHaveText("CtrlN");
});
