import type { WebContents } from "electron";
import { MEDIA_SEEK_STEP, parseMediaProbe, type MediaAction, type MediaProbe } from "@shared/media";

/** Isolated world of the media hub's probe and controls (ADR-035). */
export const MEDIA_HUB_WORLD_ID = 1011;

/**
 * Reads what the page is playing and, given an action, applies it to the media element followed.
 * Runs in an isolated world (shared DOM, separate globals: the page cannot tamper with it, and
 * nothing is left in the page's own world, ADR-003). Its state lives in the world's global: a
 * capture-phase "play" listener remembers the element the user played last, per document.
 *
 * The page's `navigator.mediaSession` action handlers live in the page's world and cannot be
 * called from here: "Reculer"/"Avancer" seek the element by `MEDIA_SEEK_STEP` seconds instead.
 */
const PROBE_SCRIPT = (action: MediaAction | null) => `((action) => {
  const hub = (globalThis.__mediaHub ??= (() => {
    const state = { last: null };
    document.addEventListener("play", (event) => {
      if (event.target instanceof HTMLMediaElement) state.last = new WeakRef(event.target);
    }, true);
    return state;
  })());
  const all = [...document.querySelectorAll("video, audio")];
  const playing = (m) => !m.paused && !m.ended;
  const last = hub.last && hub.last.deref();
  const remembered = last && last.isConnected ? last : null;
  const media = (remembered && playing(remembered) ? remembered : null) ?? all.find(playing) ?? remembered ?? all.find((m) => m.readyState > 0) ?? null;
  if (media && action) {
    const clamp = (t) => Math.max(0, Number.isFinite(media.duration) ? Math.min(t, media.duration) : t);
    if (action === "toggle") action = media.paused ? "play" : "pause";
    if (action === "play") media.play().catch(() => {});
    else if (action === "pause") media.pause();
    else if (action === "rewind") media.currentTime = clamp(media.currentTime - ${MEDIA_SEEK_STEP});
    else if (action === "forward") media.currentTime = clamp(media.currentTime + ${MEDIA_SEEK_STEP});
    else if (typeof action.seek === "number") media.currentTime = clamp(action.seek);
  }
  const meta = navigator.mediaSession && navigator.mediaSession.metadata;
  return {
    title: meta ? String(meta.title) : "",
    artist: meta ? String(meta.artist) : "",
    album: meta ? String(meta.album) : "",
    artwork: meta ? [...meta.artwork].slice(0, 8).map((a) => ({ src: String(a.src), sizes: String(a.sizes || "") })) : [],
    hasSession: !!meta,
    element: media ? { duration: media.duration, position: media.currentTime, paused: media.paused, video: media instanceof HTMLVideoElement } : null,
  };
})(${JSON.stringify(action)})`;

/**
 * Probes the page (and applies `action`, with a user gesture: `play()` needs one). Null when the
 * page cannot answer (navigating, crashed) or answered something invalid.
 */
export async function probeMedia(contents: WebContents, action: MediaAction | null = null): Promise<MediaProbe | null> {
  if (contents.isDestroyed()) return null;
  try {
    return parseMediaProbe(await contents.executeJavaScriptInIsolatedWorld(MEDIA_HUB_WORLD_ID, [{ code: PROBE_SCRIPT(action) }], action !== null));
  } catch {
    return null;
  }
}
