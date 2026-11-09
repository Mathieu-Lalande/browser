import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { isWebStorePage, webStoreIdFromUrl } from "@shared/webstore";
import { parseStorePageAction, webStorePageScript, type StoreButtonState, type StorePageAction } from "@shared/webstore-page";

/** Isolated world of the store page agent (1021: the extension popups' measure). */
export const STORE_PAGE_WORLD_ID = 1022;

/** Tags the agent's console messages; the page's own scripts cannot see it (isolated world). */
const PREFIX = `browser-store:${randomUUID()}:`;

/** A click on our button of a store page, or null for any other console message. */
export function parseStorePageMessage(message: string): StorePageAction | null {
  return message.startsWith(PREFIX) ? parseStorePageAction(message.slice(PREFIX.length)) : null;
}

export interface WebStorePagesDeps {
  /** The local fake store's origin (dev-only test hook), or null. */
  testOrigin(): string | null;
  /** What our button shows for a store extension (installed, installing, failed…). */
  stateOf(webStoreId: string): StoreButtonState;
  install(webStoreId: string): void;
  remove(webStoreId: string): void;
}

/**
 * The Chrome Web Store pages of one window's tabs (ADR-049): our "Ajouter à Browser" button in
 * place of the store's greyed one (`@shared/webstore-page`). Main recomputes the button's state on
 * every extension change and in-app navigation; a reported click is only acted on when the tab's
 * URL is the detail page of that very extension. Never in a private window (no hooks there).
 */
export class WebStorePages {
  private readonly pages = new Set<WebContents>();

  constructor(private readonly deps: WebStorePagesDeps) {}

  /** A new document of a tab (dom-ready): a store page gets the agent. */
  pageReady(contents: WebContents): void {
    if (!isWebStorePage(contents.getURL(), this.deps.testOrigin())) return;
    if (!this.pages.has(contents)) {
      this.pages.add(contents);
      // The store is an app: from search to a detail page without loading a new document.
      contents.on("did-navigate-in-page", () => this.push(contents));
      contents.once("destroyed", () => this.pages.delete(contents));
    }
    this.push(contents);
  }

  /** A click on our button, reported by the agent of `contents`. */
  clicked(contents: WebContents, click: StorePageAction): void {
    if (webStoreIdFromUrl(contents.getURL(), this.deps.testOrigin()) !== click.id) return;
    if (click.action === "install") this.deps.install(click.id);
    else this.deps.remove(click.id);
  }

  /** The extensions or an install changed: every store page shows it. */
  refresh(): void {
    for (const contents of this.pages) this.push(contents);
  }

  private push(contents: WebContents): void {
    if (contents.isDestroyed()) return;
    const url = contents.getURL();
    const testOrigin = this.deps.testOrigin();
    if (!isWebStorePage(url, testOrigin)) return;
    const id = webStoreIdFromUrl(url, testOrigin);
    const code = webStorePageScript(PREFIX, id ? this.deps.stateOf(id) : null);
    void contents.executeJavaScriptInIsolatedWorld(STORE_PAGE_WORLD_ID, [{ code }], false).catch(() => {});
  }
}
