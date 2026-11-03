import { join } from "node:path";
import { release } from "node:os";
import { app, dialog, type WebContents } from "electron";
import type { IssueContext } from "@shared/diagnostics";
import { settings } from "./settings";
import type { Bounds, TabId } from "@shared/types";
import { isViewSourceUrl } from "@shared/url";
import { downloadsFolder } from "./downloads";
import { appServices } from "./app-services-ref";
import type { BrowserController } from "./window";

/**
 * Page actions of the app menu and the page menu (ADR-033): print, save the page, view its
 * source, and the app menu popover itself.
 */

/** What "Signaler un problème" prefills the bug form with (ADR-043): version and system only. */
export function issueContext(): IssueContext {
  return {
    version: app.getVersion(),
    platform: process.platform,
    osVersion: release(),
    arch: process.arch,
    electron: process.versions.electron,
    channel: settings().updates.channel,
  };
}

/** A tab's live web page (`tabId`, else the active tab), never the start page or an internal page. */
export function webPageOf(c: BrowserController, tabId = c.tabs.activeTabId): { tabId: TabId; contents: WebContents; url: string; title: string } | null {
  const tab = c.tabs.getState().tabs.find((item) => item.id === tabId);
  const contents = tabId ? c.tabs.pageOf(tabId) : null;
  if (!tab || !contents || contents.isDestroyed() || !/^(https?|file|view-source):/.test(tab.url) || tab.interstitial) return null;
  return { tabId: tab.id, contents, url: tab.url, title: tab.title };
}

/** "Imprimer…": the print preview (ADR-042), in the overlay layer. */
export function printPage(c: BrowserController, tabId?: TabId): void {
  const page = webPageOf(c, tabId);
  if (page) void appServices().print.open(c, page.contents, page.title, page.tabId);
}

/** A file name from the page title (what Chromium's own "Save as" proposes). */
export function pageFileName(title: string, url: string): string {
  const base = (title || new URL(url).hostname || "page").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${base || "page"}.html`;
}

/**
 * "Enregistrer la page sous…": a save dialog, then `webContents.savePage` to the chosen file. The
 * page goes straight to that file: no download entry, no remembered folder, so a private window
 * writes nothing to the profile (ADR-014).
 */
export async function savePage(c: BrowserController, tabId?: TabId): Promise<boolean> {
  const page = webPageOf(c, tabId);
  if (!page || isViewSourceUrl(page.url)) return false;
  const { canceled, filePath } = await dialog.showSaveDialog(c.window, {
    title: "Enregistrer la page sous",
    defaultPath: join(downloadsFolder(), pageFileName(page.title, page.url)),
    filters: [
      { name: "Page web complète", extensions: ["html", "htm"] },
      { name: "Page web, une seule archive (MHTML)", extensions: ["mhtml"] },
    ],
  });
  if (canceled || !filePath || page.contents.isDestroyed()) return false;
  try {
    await page.contents.savePage(filePath, /\.mhtml$/i.test(filePath) ? "MHTML" : "HTMLComplete");
    return true;
  } catch (error) {
    console.warn("Save page:", error);
    return false;
  }
}

/** Opens the page's source (`view-source:`) in a new tab right after it. */
export function viewSource(c: BrowserController, tabId?: TabId): void {
  const page = webPageOf(c, tabId);
  if (!page || !/^https?:/.test(page.url)) return;
  const index = c.tabs.getState().tabs.findIndex((tab) => tab.id === page.tabId) + 1;
  c.tabs.create(`view-source:${page.url}`, { index: index || undefined });
}

/** The "…" app menu (ADR-033), in the overlay layer, hanging from `anchor` (its button) or the top-left corner. */
export function showAppMenu(c: BrowserController, anchor?: Bounds): void {
  if (c.overlay.shown === "app-menu") return c.overlay.close(true);
  c.overlay.open({ kind: "app-menu", anchor: anchor ?? { x: 8, y: 8, width: 0, height: 32 } });
}
