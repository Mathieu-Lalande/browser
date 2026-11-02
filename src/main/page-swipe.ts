import { Channels } from "@shared/ipc";
import { PageSwipe, PinchZoomSteps, type PageSwipeOutput } from "@shared/page-gestures";
import type { WheelSample } from "@shared/space-swipe";
import type { PageSwipeIndicator, TabId } from "@shared/types";
import type { PageWheelSample } from "./page-swipe-script";
import type { BrowserController } from "./window";

/** How long the commit animation shows before the indicator goes. */
const COMMIT_HIDE_MS = 160;

/**
 * Page gestures of a window (ADR-033). Two-finger horizontal swipe on the active page goes back or
 * forward: the page's watcher reports the wheel events of bursts the page cannot scroll (they are
 * not cancelled: the page gets them too, with nothing to scroll). Its
 * indicator lives in the overlay layer, which then receives the rest of the gesture's wheel events
 * and forwards them here (`feedOverlay`). Pinch / Ctrl+wheel zoom steps are paced (`zoom`).
 */
export class PageGestures {
  private readonly swipe = new PageSwipe();
  private readonly pinch = new PinchZoomSteps();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tabId: TabId | null = null;
  private shown = false;

  constructor(private readonly c: BrowserController) {}

  /** A swipe candidate the page's watcher reported (src/main/page-swipe-script.ts). */
  feedPage(tabId: TabId, sample: PageWheelSample): void {
    if (tabId !== this.c.tabs.activeTabId) return;
    // Another floating UI is open: the page does not get the input anyway.
    const overlay = this.c.overlay.shown;
    if (overlay && overlay !== "page-swipe") return;
    this.tabId = tabId;
    this.armTimer();
    this.apply(this.swipe.wheel({ ...sample, time: performance.now() }, this.history()));
  }

  /** Wheel events the overlay received while showing the indicator (it covers the page). */
  feedOverlay(sample: Omit<WheelSample, "time">): void {
    if (!this.tabId || this.c.overlay.shown !== "page-swipe") return;
    this.armTimer();
    this.apply(this.swipe.wheel({ ...sample, time: performance.now() }, this.history()));
  }

  /** A zoom request from Ctrl+wheel or a pinch (`zoom-changed`): one step at most every ~110 ms. */
  zoom(tabId: TabId, direction: 1 | -1): void {
    const step = this.pinch.request(direction, performance.now());
    if (step) this.c.tabs.zoom(tabId, step);
  }

  private history(): { back: boolean; forward: boolean } {
    const tab = this.c.tabs.getState().tabs.find((item) => item.id === this.tabId);
    return { back: !!tab?.canGoBack, forward: !!tab?.canGoForward };
  }

  private apply(output: PageSwipeOutput): void {
    switch (output.kind) {
      case "track":
        return this.show({ direction: output.direction, offset: output.offset, progress: output.progress, ready: output.ready, committed: false });
      case "commit": {
        const tabId = this.tabId;
        if (tabId) {
          if (output.direction < 0) this.c.tabs.back(tabId);
          else this.c.tabs.forward(tabId);
        }
        if (this.shown) this.c.overlay.send(Channels.pageSwipeState, { direction: output.direction, offset: 0, progress: 1, ready: true, committed: true });
        setTimeout(() => this.hide(), COMMIT_HIDE_MS);
        return;
      }
      case "cancel":
        return this.hide();
    }
  }

  private show(indicator: PageSwipeIndicator): void {
    if (!this.shown) {
      this.shown = true;
      this.c.overlay.open({ kind: "page-swipe", anchor: this.c.tabs.viewBounds, swipe: indicator });
    }
    this.c.overlay.send(Channels.pageSwipeState, indicator);
  }

  private hide(): void {
    if (!this.shown) return;
    this.shown = false;
    if (this.c.overlay.shown === "page-swipe") this.c.overlay.close();
  }

  /** Releases a gesture once the events stop. */
  private armTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.apply(this.swipe.end(performance.now(), this.history()));
    }, this.swipe.endGapMs + 10);
  }
}
