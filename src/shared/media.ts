/**
 * Media hub ("Pause des médias", ADR-035): what a tab's page is playing, as main reports it to the
 * chrome UI, and the pure rules of the mini-player. Pure: no Electron, no Node, no DOM (shared
 * with the mobile app).
 */

import type { SpaceId, TabId } from "./types";

/** A paused source stays in the mini-player this long after its last play/pause change. */
export const MEDIA_RECENT_MS = 5 * 60_000;
/** "Reculer"/"Avancer": seconds jumped in the media element. */
export const MEDIA_SEEK_STEP = 10;
/** Largest artwork image main fetches (bytes, before base64). */
export const MAX_ARTWORK_BYTES = 256 * 1024;
/** Longest metadata string kept (title, artist, album). */
export const MAX_MEDIA_TEXT = 300;
/** Artwork candidates kept from the page's list. */
const MAX_ARTWORK_CANDIDATES = 8;
/** Preferred artwork edge, in px (the card draws it at 40 px, ×2 for high-density screens). */
const ARTWORK_TARGET = 96;

/** What the probe reads in a page (isolated world / injected script): untrusted until parsed. */
export interface MediaProbe {
  /** `navigator.mediaSession.metadata`, empty strings when the page set none. */
  title: string;
  artist: string;
  album: string;
  /** Artwork URL chosen among the page's candidates (http(s) or a raster data: URL), or null. */
  artwork: string | null;
  /** The page set media session metadata. */
  hasSession: boolean;
  /** The media element followed: null when the page has none the probe can reach. */
  element: MediaElementState | null;
}

export interface MediaElementState {
  /** Seconds; null for a live stream or an unknown duration. */
  duration: number | null;
  /** Seconds. */
  position: number;
  paused: boolean;
  /** A <video> (picture-in-picture is offered). */
  video: boolean;
}

/** One tab playing (or recently paused) media, as main sends it to the chrome UI. */
export interface MediaSource {
  tabId: TabId;
  spaceId: SpaceId;
  /** Metadata title, else the tab's title. */
  title: string;
  /** Metadata artist (else album), else the page's host. */
  subtitle: string;
  /** Artwork as a raster `data:` URL fetched by main, else the tab's favicon, else null. */
  artwork: string | null;
  playing: boolean;
  muted: boolean;
  /** Seconds, null when unknown (live). */
  duration: number | null;
  /** Seconds at `positionAt`. */
  position: number;
  /** Epoch ms of the `position` reading (the UI extrapolates while playing). */
  positionAt: number;
  video: boolean;
  /** The page has a media element the controls can reach (play/pause, seek). */
  controllable: boolean;
  /** Epoch ms of the last play/pause change: the most recent player first. */
  changedAt: number;
}

/** What the mini-player asks main to do on a source. */
export type MediaAction = "toggle" | "play" | "pause" | "rewind" | "forward" | { seek: number };

export const isMediaAction = (value: unknown): value is MediaAction =>
  value === "toggle" ||
  value === "play" ||
  value === "pause" ||
  value === "rewind" ||
  value === "forward" ||
  (typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 1 &&
    typeof (value as { seek?: unknown }).seek === "number" &&
    Number.isFinite((value as { seek: number }).seek) &&
    (value as { seek: number }).seek >= 0);

const text = (value: unknown): string =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_MEDIA_TEXT) : "";

const seconds = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);

/** Raster data: URL of at most `MAX_ARTWORK_BYTES` (same shape as favicons, ADR-018). */
const ARTWORK_DATA_URL = /^data:image\/(png|gif|jpeg|webp|avif|bmp);base64,[A-Za-z0-9+/]+={0,2}$/i;
const MAX_ARTWORK_DATA_URL = Math.ceil(MAX_ARTWORK_BYTES / 3) * 4 + 64;

export const isArtworkDataUrl = (value: string): boolean => value.length <= MAX_ARTWORK_DATA_URL && ARTWORK_DATA_URL.test(value);

/** Largest edge of a `sizes` value ("96x96 128x128" → 128; "any" or nothing → 0). */
function edgeOf(sizes: unknown): number {
  if (typeof sizes !== "string") return 0;
  let best = 0;
  for (const match of sizes.matchAll(/(\d+)x(\d+)/gi)) best = Math.max(best, Math.min(Number(match[1]), Number(match[2])));
  return best;
}

/**
 * The artwork to show among the page's candidates: the smallest one at least `ARTWORK_TARGET` px
 * wide, else the largest; only http(s) or raster data: URLs.
 */
export function pickArtwork(candidates: unknown): string | null {
  if (!Array.isArray(candidates)) return null;
  const usable = candidates
    .slice(0, MAX_ARTWORK_CANDIDATES)
    .map((entry) => ({ src: typeof entry?.src === "string" ? entry.src : "", edge: edgeOf(entry?.sizes) }))
    .filter(({ src }) => (/^https?:\/\//i.test(src) && src.length <= 2048) || isArtworkDataUrl(src));
  if (!usable.length) return null;
  const big = usable.filter(({ edge }) => edge >= ARTWORK_TARGET).sort((a, b) => a.edge - b.edge);
  return (big[0] ?? [...usable].sort((a, b) => b.edge - a.edge)[0]).src;
}

/** Validates what a page's probe returned (the page shares the DOM it reads: never trusted). */
export function parseMediaProbe(raw: unknown): MediaProbe | null {
  if (typeof raw !== "object" || raw === null) return null;
  const probe = raw as Record<string, unknown>;
  const element = probe.element as Record<string, unknown> | null | undefined;
  const parsedElement: MediaElementState | null =
    element && typeof element === "object"
      ? {
          duration: seconds(element.duration),
          position: seconds(element.position) ?? 0,
          paused: element.paused !== false,
          video: element.video === true,
        }
      : null;
  return {
    title: text(probe.title),
    artist: text(probe.artist),
    album: text(probe.album),
    artwork: pickArtwork(probe.artwork),
    hasSession: probe.hasSession === true,
    element: parsedElement,
  };
}

/** The page's host for a subtitle ("www." dropped), or "". */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Title and subtitle of a source: the page's metadata first, the tab's title and host otherwise. */
export function mediaLabels(probe: Pick<MediaProbe, "title" | "artist" | "album"> | null, tab: { title: string; url: string }): { title: string; subtitle: string } {
  return {
    title: probe?.title || tab.title || hostOf(tab.url),
    subtitle: probe?.artist || probe?.album || hostOf(tab.url),
  };
}

/** Where a source is now, in seconds (extrapolated while playing, never past the end). */
export function currentPosition(source: Pick<MediaSource, "position" | "positionAt" | "playing" | "duration">, now: number): number {
  const elapsed = source.playing ? Math.max(0, now - source.positionAt) / 1000 : 0;
  const position = source.position + elapsed;
  return source.duration === null ? position : Math.min(position, source.duration);
}

/** Progress 0…1, or null for a live stream (no bar). */
export function progressOf(source: Pick<MediaSource, "position" | "positionAt" | "playing" | "duration">, now: number): number | null {
  if (!source.duration) return null;
  return Math.min(1, Math.max(0, currentPosition(source, now) / source.duration));
}

/** "1:05", "1:02:03"; "En direct" when the duration is unknown. */
export function formatMediaTime(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "En direct";
  const total = Math.max(0, Math.floor(value));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Whether a source still belongs in the hub: playing, or paused less than `MEDIA_RECENT_MS` ago. */
export const isRecentSource = (source: Pick<MediaSource, "playing" | "changedAt">, now: number): boolean =>
  source.playing || now - source.changedAt <= MEDIA_RECENT_MS;

/** Most recent first: playing sources before paused ones, then by last change. */
export const byRecency = (a: MediaSource, b: MediaSource): number => Number(b.playing) - Number(a.playing) || b.changedAt - a.changedAt;

/**
 * What the sidebar's mini-player shows: the recent sources except the tabs on screen (the active
 * tab, and the split shown with it), most recent first.
 */
export function miniPlayerSources(sources: readonly MediaSource[], shownTabIds: readonly TabId[], now: number): MediaSource[] {
  const shown = new Set(shownTabIds);
  return sources.filter((source) => !shown.has(source.tabId) && isRecentSource(source, now)).sort(byRecency);
}

/** The source "Tout mettre en pause" and the media keys care about first: the most recent player. */
export function mostRecentPlayer(sources: readonly MediaSource[]): MediaSource | null {
  return [...sources].filter((source) => source.playing).sort(byRecency)[0] ?? null;
}

/**
 * Builds a source from a tab, its probe and the play state main follows. `previous`: the source
 * as last sent (keeps `changedAt` while the play state does not change).
 */
export function buildSource(input: {
  tabId: TabId;
  spaceId: SpaceId;
  tab: { title: string; url: string; favicon: string | null; isMuted: boolean };
  probe: MediaProbe | null;
  artwork: string | null;
  playing: boolean;
  now: number;
  previous?: MediaSource;
}): MediaSource {
  const { tabId, spaceId, tab, probe, playing, now, previous } = input;
  const element = probe?.element ?? null;
  const labels = mediaLabels(probe, tab);
  return {
    tabId,
    spaceId,
    ...labels,
    artwork: input.artwork ?? tab.favicon,
    playing,
    muted: tab.isMuted,
    duration: element?.duration ?? null,
    position: element?.position ?? (previous ? currentPosition(previous, now) : 0),
    positionAt: now,
    video: element?.video ?? false,
    controllable: element !== null,
    changedAt: previous && previous.playing === playing ? previous.changedAt : now,
  };
}

/** Whether two sources would draw the same (position compared after extrapolation, to 1 s). */
export function sameSource(a: MediaSource | undefined, b: MediaSource, now: number): boolean {
  if (!a) return false;
  const { position: _pa, positionAt: _ta, ...restA } = a;
  const { position: _pb, positionAt: _tb, ...restB } = b;
  return JSON.stringify(restA) === JSON.stringify(restB) && Math.abs(currentPosition(a, now) - currentPosition(b, now)) < 1.5;
}
