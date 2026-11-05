import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";

/**
 * The page side of the two-finger swipe (ADR-033). Electron's `input-event` carries no wheel
 * deltas, and pages never get a preload: a small watcher runs in an isolated world of each page
 * (shared DOM, no page globals, ADR-003). It classifies each burst of trusted wheel events on the
 * spot, where the page's scroll positions are known:
 *
 * - a horizontal pixel burst (touchpad) that the element under the pointer, its ancestors and the
 *   document cannot scroll any further that way is a swipe candidate;
 * - anything else (vertical, mouse wheel, Ctrl/Shift, or a page that scrolls that way) is the page's.
 *
 * Only candidates are reported, as `console.debug` messages tagged with a per-run secret prefix
 * that the page's own scripts cannot see (isolated world): they cannot forge a swipe, and vertical
 * scrolling costs nothing. Main reads them from `console-message` (main frame only).
 */

const PREFIX = `browser-swipe:${randomUUID()}:`;
/** Isolated world of the watcher. */
const WORLD_ID = 1010;
/** A pause this long starts a new burst (same as the gesture's release gap). */
const BURST_GAP_MS = 140;

export interface PageWheelSample {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  shiftKey: boolean;
}

const SCRIPT = `(() => {
  if (globalThis.__browserSwipe) return;
  globalThis.__browserSwipe = true;
  const prefix = ${JSON.stringify(PREFIX)};
  const scrolls = (el, direction) => {
    if (!el || el.scrollWidth <= el.clientWidth + 1) return false;
    const root = el === document.scrollingElement || el === document.documentElement || el === document.body;
    if (!root) {
      const overflow = getComputedStyle(el).overflowX;
      if (overflow !== "auto" && overflow !== "scroll") return false;
    }
    return direction < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
  };
  const pageScrolls = (event, direction) => {
    for (const node of event.composedPath()) if (node instanceof Element && scrolls(node, direction)) return true;
    return scrolls(document.scrollingElement, direction);
  };
  let burst = null;
  addEventListener("wheel", (event) => {
    if (!event.isTrusted) return;
    const now = event.timeStamp;
    if (!burst || now - burst.last > ${BURST_GAP_MS}) {
      burst = { last: now, x: 0, y: 0, swipe: null };
    }
    burst.last = now;
    if (burst.swipe === null) {
      burst.x += event.deltaX;
      burst.y += event.deltaY;
      if (Math.abs(burst.x) + Math.abs(burst.y) >= 4) {
        const horizontal = event.deltaMode === 0 && !event.ctrlKey && !event.shiftKey && Math.abs(burst.x) > Math.abs(burst.y) * 1.2;
        burst.swipe = horizontal && !pageScrolls(event, Math.sign(burst.x));
      }
    }
    if (burst.swipe) console.debug(prefix + JSON.stringify([event.deltaX, event.deltaY, event.deltaMode, event.ctrlKey ? 1 : 0, event.shiftKey ? 1 : 0]));
  }, { capture: true, passive: true });
})()`;

/** Installs the watcher in a new document of a tab (dom-ready). */
export function watchPageWheel(contents: WebContents): void {
  if (contents.isDestroyed() || !/^(https?|file):/.test(contents.getURL())) return;
  void contents.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code: SCRIPT }], false).catch(() => {});
}

/** A watcher message, or null for any other console message. */
export function parsePageWheel(message: string): PageWheelSample | null {
  if (!message.startsWith(PREFIX)) return null;
  try {
    const value: unknown = JSON.parse(message.slice(PREFIX.length));
    if (!Array.isArray(value) || value.length !== 5 || !value.every((item) => typeof item === "number" && Number.isFinite(item))) return null;
    const [deltaX, deltaY, deltaMode, ctrl, shift] = value as number[];
    return { deltaX, deltaY, deltaMode, ctrlKey: ctrl === 1, shiftKey: shift === 1 };
  } catch {
    return null;
  }
}
