import { resolveAction, type ActionProps, type ActionState } from "@shared/extension-api";
import type { ExtensionInfo } from "@shared/extensions";
import type { Bounds } from "@shared/types";
import { webStoreIdFromUrl } from "@shared/webstore";
import { STORE_PHASE_LABELS, type StoreInstall } from "@shared/webstore-page";
import { api, browser } from "./browser.svelte";

/**
 * The chrome UI's view of the extensions (ADR-049): the list (live), the toolbar buttons of the
 * sidebar row, the store installs main runs (téléchargement → vérification → installation, or
 * the last failure) and the Chrome Web Store page on screen with its "Ajouter à Browser" flow,
 * shared by the address bar button, the store bar and our button inside the store page. Started
 * by its first user.
 */
class ExtensionsUi {
  list = $state<ExtensionInfo[]>([]);
  installs = $state<StoreInstall[]>([]);
  /** Badges, titles and icons the extensions set (`chrome.action`, ADR-053), by extension id. */
  actions = $state<Record<string, ActionState>>({});
  /** A local fake store's origin (dev-only test hook), or null. */
  storeOrigin = $state<string | null>(null);
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

  /** The install of the page's extension, in progress or failed. */
  readonly pageInstall = $derived(this.installs.find((install) => install.webStoreId === this.pageStoreId) ?? null);

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.refresh();
    api.extensions.onChanged(() => void this.refresh());
    api.extensions.onInstalled((id) => void this.confirm(id));
    api.extensions.onActionStates((states) => (this.actions = states));
    void api.extensions.actionStates().then((states) => (this.actions = states), () => null);
    void api.extensions.storeOrigin().then((origin) => (this.storeOrigin = origin), () => null);
  }

  /** An extension's button as the active tab shows it (its own values over the global ones). */
  actionOf(id: string): ActionProps {
    return resolveAction(this.actions[id], browser.activeTab?.id);
  }

  async refresh(): Promise<void> {
    const id = ++this.request;
    const [list, installs] = await Promise.all([api.extensions.list().catch(() => null), api.extensions.storeInstalls().catch(() => null)]);
    if (id !== this.request) return;
    if (list) this.list = list;
    if (installs) this.installs = installs;
  }

  /** "Ajouter à Browser" (or "Réessayer"): main downloads, verifies and asks; progress and failures come back as `installs`. */
  installFromStore(webStoreId: string): void {
    void api.extensions.installFromStore(webStoreId).catch(() => null);
  }

  /** What a store install shows ("Vérification…"), or null when there is none in progress. */
  phaseLabel(install: StoreInstall | null): string | null {
    return install && install.phase !== "error" ? STORE_PHASE_LABELS[install.phase] : null;
  }

  /** After an install from this window: the confirmation hangs from the extension bar (its puzzle button). */
  private async confirm(id: string): Promise<void> {
    await this.refresh();
    // Let the extension bar appear if this was the first extension.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const anchor = document.querySelector<HTMLElement>("[data-extensions-anchor]") ?? document.querySelector<HTMLElement>(".address-bar, form");
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const bounds: Bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    api.extensions.showInstalled(id, bounds);
  }
}

export const extensionsUi = new ExtensionsUi();
