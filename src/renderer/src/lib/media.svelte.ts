import { miniPlayerSources, type MediaSource } from "@shared/media";
import { browser } from "./browser.svelte";

/** Clock period of the mini-player (progress and the 5 min expiry), only while something is listed. */
const TICK_MS = 500;

/**
 * Reactive mirror of the window's media hub (ADR-035), pushed by main on every change. The
 * mini-player lists the sources not on screen (the active tab and its split are left out).
 */
class MediaStore {
  sources = $state<MediaSource[]>([]);
  /** Epoch ms, ticking while sources exist (position extrapolation, expiry of paused ones). */
  now = $state(Date.now());

  private timer: ReturnType<typeof setInterval> | null = null;

  /** What the sidebar shows, most recent first. */
  shown: MediaSource[] = $derived.by(() => {
    const onScreen = browser.splitTabs.length ? browser.splitTabs.map((tab) => tab.id) : [browser.state.activeTabId ?? ""];
    return miniPlayerSources(this.sources, onScreen, this.now);
  });

  constructor() {
    window.browser.media.onChanged((sources) => this.update(sources));
    window.browser.media.list().then((sources) => this.update(sources), () => {});
  }

  private update(sources: MediaSource[]): void {
    this.sources = sources;
    this.now = Date.now();
    if (sources.length && !this.timer) this.timer = setInterval(() => (this.now = Date.now()), TICK_MS);
    else if (!sources.length && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const media = new MediaStore();
