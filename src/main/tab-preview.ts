import { favoriteTab } from "@shared/favorites";
import { webHostname } from "@shared/hosts";
import { TAB_PREVIEW, ThumbnailCache, previewCardBounds, previewViewBounds, type TabPreview } from "@shared/tab-preview";
import type { Bounds, TabId, TabState } from "@shared/types";
import { displayUrl } from "@shared/url";
import { appServices } from "./app-services-ref";
import { favoriteTiles } from "./organize";
import { settings } from "./settings";
import type { BrowserController } from "./window";

/** After a tab comes on screen or finishes loading, its thumbnail is taken this much later (painted). */
const CAPTURE_SETTLE_MS = 700;
/** Thumbnails are this many times the card's CSS width (sharp on HiDPI screens, still a few dozen KB). */
const THUMBNAIL_SCALE = 2;

/** What the chrome UI hovers: a tab of this window, or a favorite tile (open or not). */
type Target = { kind: "tab"; id: TabId } | { kind: "favorite"; url: string };

/**
 * Tab hover preview of a window (ADR-038). Main owns the thumbnails: a tab's page is captured
 * (`capturePage`, downscaled, JPEG) while it is on screen, after it shows or finishes loading,
 * and when hovered if its thumbnail is stale; only detached pages (background, sleeping) fall back
 * to their last thumbnail, or none. Thumbnails stay in memory (private windows included) and
 * reach the overlay as `data:` URLs only. The card lives in the overlay layer, in a view no larger
 * than itself, so the sidebar below keeps the pointer.
 */
export class TabPreviews {
  private readonly cache = new ThumbnailCache();
  private shown: { target: Target; anchor: Bounds } | null = null;
  private readonly capturing = new Set<TabId>();
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastActive: TabId | null = null;
  private lastLoading = false;

  constructor(private readonly c: BrowserController) {
    c.window.on("resize", () => this.hide());
    c.window.on("blur", () => this.hide());
  }

  /** The chrome UI hovers `target` (its row at `anchor`, window coordinates): show or move the card. */
  show(target: Target, anchor: Bounds): void {
    if (!settings().layout.tabHoverPreview) return;
    const shownKind = this.c.overlay.shown;
    if (shownKind && shownKind !== "tab-preview") return;
    this.shown = { target, anchor };
    this.render();
    const tab = this.tabOf(target);
    if (tab && this.c.tabs.visiblePage(tab.id) && this.cache.needsCapture(tab.id, tab.url, Date.now())) void this.capture(tab.id);
  }

  destroy(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    this.shown = null;
    this.cache.clear();
  }

  hide(): void {
    this.shown = null;
    if (this.c.overlay.shown === "tab-preview") this.c.overlay.close();
  }

  /** Every state change of the window: thumbnails follow navigations, closed tabs are forgotten. */
  sync(): void {
    const tabs = this.c.spaces.allTabs().map(({ tab }) => tab);
    for (const tab of tabs) this.cache.navigated(tab.id, tab.url);
    this.cache.retain(new Set(tabs.map((tab) => tab.id)));
    const active = tabs.find((tab) => tab.id === this.c.tabs.activeTabId) ?? null;
    const loading = !!active?.isLoading;
    // A tab just shown, or done loading: take its picture once painted.
    // Energy saver (ADR-048): only when a tab shows, and later.
    const loaded = this.lastLoading && !loading && appServices().energy.policy.captureOnLoad;
    if (active && (active.id !== this.lastActive || loaded)) this.scheduleCapture(active.id);
    this.lastActive = active?.id ?? null;
    this.lastLoading = loading;
    // The card follows its tab (title, sound, sleep) while shown.
    if (this.shown && this.c.overlay.shown === "tab-preview") this.render();
  }

  private scheduleCapture(id: TabId): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      void this.capture(id);
    }, appServices().energy.policy.captureSettleMs(CAPTURE_SETTLE_MS));
  }

  private async capture(id: TabId): Promise<void> {
    const page = this.c.tabs.visiblePage(id);
    if (!page || this.capturing.has(id) || this.c.window.isDestroyed()) return;
    const url = page.getURL();
    this.capturing.add(id);
    try {
      const image = await page.capturePage();
      if (image.isEmpty() || page.isDestroyed()) return;
      const small = image.resize({ width: TAB_PREVIEW.width * THUMBNAIL_SCALE, quality: "good" });
      this.cache.put(id, url, `data:image/jpeg;base64,${small.toJPEG(72).toString("base64")}`, Date.now());
      const shownTab = this.shown && this.tabOf(this.shown.target);
      if (shownTab?.id === id && this.c.overlay.shown === "tab-preview") this.render();
    } catch {
      // A page closing mid-capture: the card keeps its favicon.
    } finally {
      this.capturing.delete(id);
    }
  }

  private tabOf(target: Target): TabState | null {
    const tabs = this.c.spaces.allTabs().map(({ tab }) => tab);
    return (target.kind === "tab" ? tabs.find((tab) => tab.id === target.id) : favoriteTab(target.url, tabs)) ?? null;
  }

  private previewOf(target: Target): TabPreview | null {
    const tab = this.tabOf(target);
    if (tab) {
      const thumbnail = this.cache.get(tab.id, tab.url);
      return {
        tabId: tab.id,
        title: tab.title,
        url: tab.url,
        // No picture of a sleeping tab: its address says more than its host.
        host: (tab.isAsleep && !thumbnail ? "" : webHostname(tab.url)) || displayUrl(tab.url),
        favicon: tab.favicon,
        thumbnail,
        asleep: !!tab.isAsleep,
        audible: tab.isAudible,
        muted: tab.isMuted,
      };
    }
    if (target.kind !== "favorite") return null;
    const tile = favoriteTiles(this.c).find((favorite) => favorite.url === target.url);
    if (!tile) return null;
    return { tabId: null, title: tile.title, url: tile.url, host: webHostname(tile.url), favicon: tile.favicon, thumbnail: null, asleep: false, audible: false, muted: false };
  }

  private render(): void {
    if (!this.shown || this.c.window.isDestroyed()) return;
    const preview = this.previewOf(this.shown.target);
    if (!preview) return this.hide();
    const { width, height } = this.c.window.getContentBounds();
    const card = previewCardBounds(this.shown.anchor, { width, height }, !!preview.thumbnail);
    this.c.overlay.open({ kind: "tab-preview", preview, region: previewViewBounds(card) });
  }
}
