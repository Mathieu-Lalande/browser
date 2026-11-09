import type { ExtensionInfo } from "@shared/extensions";
import { webStoreIdFromUrl } from "@shared/webstore";
import { api, browser } from "./browser.svelte";

/** What the last store install said, shown by the store bar of the tab it was started from. */
export interface StoreNotice {
  webStoreId: string;
  kind: "error" | "success";
  text: string;
}

/**
 * The chrome UI's view of the extensions (ADR-049): the list (live), the toolbar buttons of the
 * sidebar row, and the Chrome Web Store page on screen with its "Ajouter à Browser" flow, shared by
 * the address bar button and the store bar. Started by its first user.
 */
class ExtensionsUi {
  list = $state<ExtensionInfo[]>([]);
  /** A local fake store's origin (dev-only test hook), or null. */
  storeOrigin = $state<string | null>(null);
  /** Store id being downloaded / reviewed. */
  installing = $state<string | null>(null);
  notice = $state<StoreNotice | null>(null);
  private started = false;
  private request = 0;

  /** Extensions with a toolbar button, enabled. */
  readonly withAction = $derived(this.list.filter((extension) => extension.enabled && extension.action));

  /** The Chrome Web Store extension the active tab shows, installed or not (never in a private window). */
  readonly pageStoreId = $derived(browser.isPrivate ? null : webStoreIdFromUrl(browser.activeTab?.url ?? "", this.storeOrigin));

  /** The same, unless already installed: what "Ajouter à Browser" offers. */
  readonly storeCandidate = $derived.by(() => {
    const id = this.pageStoreId;
    return id && !this.list.some((extension) => extension.webStoreId === id) ? id : null;
  });

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.refresh();
    api.extensions.onChanged(() => void this.refresh());
    void api.extensions.storeOrigin().then((origin) => (this.storeOrigin = origin), () => null);
  }

  async refresh(): Promise<void> {
    const id = ++this.request;
    const list = await api.extensions.list().catch(() => null);
    if (list && id === this.request) this.list = list;
  }

  /** "Ajouter à Browser": main downloads, verifies and asks; the outcome becomes the notice. */
  async installFromStore(webStoreId: string): Promise<void> {
    if (this.installing) return;
    this.installing = webStoreId;
    this.notice = null;
    const result = await api.extensions.installFromStore(webStoreId).catch(() => ({ ok: false as const, message: "L'installation a échoué." }));
    this.installing = null;
    if (result) {
      this.notice = result.ok
        ? { webStoreId, kind: "success", text: `« ${result.extension.name} » est installée.` }
        : { webStoreId, kind: "error", text: result.message };
    }
    void this.refresh();
  }
}

export const extensionsUi = new ExtensionsUi();
