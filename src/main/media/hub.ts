import type { WebContents } from "electron";
import { MAX_ARTWORK_BYTES, buildSource, isArtworkDataUrl, isRecentSource, sameSource, type MediaAction, type MediaProbe, type MediaSource } from "@shared/media";
import { Channels } from "@shared/ipc";
import type { SpaceId, TabId, TabState } from "@shared/types";
import { fetchImageDataUrl } from "../favicons";
import { faviconRequestUrl } from "../privacy";
import type { TabManager } from "../tabs";
import { togglePictureInPicture } from "./pip";
import { probeMedia } from "./probe";

/** Polling period of playing pages (position, track changes); nothing is polled while all are paused. */
const POLL_MS = 1000;

/** What the hub needs from its window (BrowserController). */
export interface MediaHost {
  readonly spaces: {
    allTabs(): { spaceId: SpaceId; manager: TabManager; tab: TabState }[];
    showTab(spaceId: SpaceId, tabId: TabId): void;
  };
  send(channel: string, ...args: unknown[]): void;
}

interface Entry {
  contents: WebContents;
  /** Last play state Chromium reported (`media-started-playing` / `media-paused`). */
  reported: boolean;
  probe: MediaProbe | null;
  /** The artwork URL the page declared, and what main fetched for it. */
  artworkUrl: string | null;
  artwork: string | null;
  /** "Fermer" in the mini-player: hidden until the page plays again. */
  dismissed: boolean;
  source?: MediaSource;
}

/**
 * The media hub of one window (ADR-035): which tabs play (or recently paused) media, with their
 * metadata, polled only while something plays. Nothing is written anywhere (private windows
 * included): the state lives as long as the pages.
 */
export class MediaHub {
  private readonly entries = new Map<TabId, Entry>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private sent: MediaSource[] = [];

  constructor(private readonly host: MediaHost) {}

  /** What the chrome UI draws (most recent first is up to the UI). */
  sources(): MediaSource[] {
    return this.sent;
  }

  /** A tab's page started or stopped playing (TabManager's `media` hook). */
  report(tabId: TabId, contents: WebContents, playing: boolean): void {
    let entry = this.entries.get(tabId);
    if (!entry || entry.contents !== contents) {
      entry = { contents, reported: playing, probe: null, artworkUrl: null, artwork: null, dismissed: false };
      this.entries.set(tabId, entry);
      contents.once("destroyed", () => {
        if (this.entries.get(tabId)?.contents !== contents) return;
        this.entries.delete(tabId);
        this.publish();
      });
    }
    entry.reported = playing;
    if (playing) entry.dismissed = false;
    void this.refresh(tabId, entry);
  }

  /** Tab state changed (title, mute, closed, moved…): re-sends what changed. */
  sync(): void {
    if (this.entries.size) this.publish();
  }

  /** Runs a control in the tab's page, then reports the new state. */
  async act(tabId: TabId, action: MediaAction): Promise<void> {
    const entry = this.entries.get(tabId);
    if (entry) await this.refresh(tabId, entry, action);
  }

  pictureInPicture(tabId: TabId): void {
    const entry = this.entries.get(tabId);
    if (entry && !entry.contents.isDestroyed()) void togglePictureInPicture(entry.contents);
  }

  /** "Aller à l'onglet": shows the tab, switching space if needed. */
  focus(tabId: TabId): void {
    const found = this.host.spaces.allTabs().find(({ tab }) => tab.id === tabId);
    if (found) this.host.spaces.showTab(found.spaceId, tabId);
  }

  toggleMute(tabId: TabId): void {
    this.host.spaces.allTabs().find(({ tab }) => tab.id === tabId)?.manager.toggleMute(tabId);
  }

  /** "Fermer": pauses the source and hides it until it plays again. */
  async dismiss(tabId: TabId): Promise<void> {
    const entry = this.entries.get(tabId);
    if (!entry) return;
    entry.dismissed = true;
    await this.act(tabId, "pause");
    this.publish();
  }

  /** "Tout mettre en pause": every playing source of the window. */
  async pauseAll(): Promise<void> {
    const playing = [...this.entries].filter(([, entry]) => entry.source?.playing ?? entry.reported);
    await Promise.all(playing.map(([tabId]) => this.act(tabId, "pause")));
  }

  destroy(): void {
    this.stopPolling();
    this.entries.clear();
  }

  /** Probes the page (applying `action`), fetches new artwork, and re-sends. */
  private async refresh(tabId: TabId, entry: Entry, action: MediaAction | null = null): Promise<void> {
    const probe = await probeMedia(entry.contents, action);
    if (this.entries.get(tabId) !== entry) return;
    entry.probe = probe;
    if (action === "pause") entry.reported = false;
    // Nothing the hub can show or control any more (navigated away, media removed); media it cannot
    // reach (a frame, a detached Audio object) stays while Chromium hears it.
    const unreachableButPlaying = entry.reported && !entry.contents.isDestroyed() && entry.contents.isCurrentlyAudible();
    if (!probe?.element && !probe?.hasSession && !unreachableButPlaying) {
      this.entries.delete(tabId);
    } else if ((probe?.artwork ?? null) !== entry.artworkUrl) {
      entry.artworkUrl = probe?.artwork ?? null;
      entry.artwork = null;
      void this.loadArtwork(entry, entry.artworkUrl);
    }
    this.publish();
  }

  /** Artwork as a data: URL, fetched with the tab's own session like favicons (ADR-018). */
  private async loadArtwork(entry: Entry, url: string | null): Promise<void> {
    if (!url || entry.contents.isDestroyed()) return;
    let artwork: string | null = null;
    if (url.startsWith("data:")) artwork = isArtworkDataUrl(url) ? url : null;
    else {
      const allowed = faviconRequestUrl(entry.contents, url, entry.contents.getURL());
      if (allowed) artwork = await fetchImageDataUrl(entry.contents.session, allowed, MAX_ARTWORK_BYTES).catch(() => null);
    }
    if (entry.artworkUrl !== url || !artwork) return;
    entry.artwork = artwork;
    this.publish();
  }

  /** Rebuilds the sources from the entries and the tabs, and sends them if anything changed. */
  private publish(): void {
    const now = Date.now();
    const tabs = new Map(this.host.spaces.allTabs().map((item) => [item.tab.id, item]));
    const next: MediaSource[] = [];
    for (const [tabId, entry] of this.entries) {
      const found = tabs.get(tabId);
      if (!found || entry.contents.isDestroyed()) {
        this.entries.delete(tabId);
        continue;
      }
      const element = entry.probe?.element;
      // The probe knows best (Chromium reports "paused" when any one element pauses); the page's
      // own report counts for media the probe cannot reach (frames, detached Audio objects).
      const playing = element ? !element.paused : entry.reported;
      const source = buildSource({ tabId, spaceId: found.spaceId, tab: found.tab, probe: entry.probe, artwork: entry.artwork, playing, now, previous: entry.source });
      // An unchanged source keeps its reading time, so the UI's extrapolation does not jump.
      entry.source = sameSource(entry.source, source, now) ? entry.source! : source;
      if (!isRecentSource(entry.source, now)) {
        this.entries.delete(tabId);
        continue;
      }
      if (!entry.dismissed) next.push(entry.source);
    }
    const changed = next.length !== this.sent.length || next.some((source, i) => source !== this.sent[i]);
    this.sent = next;
    if (changed) this.host.send(Channels.mediaChanged, next);
    if ([...this.entries.values()].some((entry) => entry.source?.playing)) this.startPolling();
    else this.stopPolling();
  }

  private startPolling(): void {
    this.timer ??= setInterval(() => {
      for (const [tabId, entry] of this.entries) if (entry.source?.playing) void this.refresh(tabId, entry);
    }, POLL_MS);
  }

  private stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
