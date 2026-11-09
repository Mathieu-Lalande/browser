/**
 * Page captures (ADR-031): screenshots of the visible area, the whole page or one element, and
 * video recordings of a tab. Pure helpers shared by main and the UI: file names, clip geometry,
 * the recording timer.
 */

import { t } from "./i18n";

export type CaptureMode = "visible" | "full" | "element";

/** A rectangle in CSS pixels of the page (document coordinates for clips). */
export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Chromium refuses bigger bitmaps (GPU texture limit): longer pages are cut there. */
export const MAX_CAPTURE_SIZE = 16384;

/** A recording sent back by the UI is refused past this size (IPC copy, written in one go). */
export const MAX_RECORDING_BYTES = 1024 * 1024 * 1024;

/** What the capture result popover shows (the image itself stays in main). */
export interface CaptureResult {
  id: string;
  width: number;
  height: number;
  /** Small JPEG preview, `data:` URL (the UI's CSP only allows `data:` images). */
  preview: string;
}

/** The window's recording, if any (ADR-031): shown in the address bar while it runs. */
export interface RecordingState {
  tabId: string;
  /** ms since the epoch. */
  startedAt: number;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The site part of a capture's name: the host without `www.`, else "page". */
export function captureSite(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    // Not a URL: generic name.
  }
  host = host.replace(/^www\./, "").replace(/[^\w.-]/g, "");
  return host || "page";
}

/**
 * Default file name: `Capture exemple.fr 2026-11-02 14.05.09.png`, or `Enregistrement … .webm` for
 * a video. Local time; no character any file system refuses (no `:` nor `/`).
 */
export function captureFileName(url: string, date: Date, kind: "image" | "video" = "image"): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
  const prefix = kind === "image" ? t("capture.screenshot") : t("capture.recording");
  return `${prefix} ${captureSite(url)} ${day} ${time}.${kind === "image" ? "png" : "webm"}`;
}

const size = (value: number) => Math.max(1, Math.min(MAX_CAPTURE_SIZE, Math.ceil(value)));

/** The whole document (`Page.getLayoutMetrics`' content size), capped to what Chromium can draw. */
export function fullPageClip(content: { width: number; height: number }): CaptureRect {
  return { x: 0, y: 0, width: size(content.width), height: size(content.height) };
}

/** Past this many output pixels (~256 MB of RGBA), a capture is scaled down instead of drawn whole. */
export const MAX_CAPTURE_PIXELS = 64_000_000;

/**
 * The `scale` of a clip so the bitmap (CSS size × device pixel ratio × scale) stays within
 * `MAX_CAPTURE_PIXELS`: 1 for ordinary captures, less for huge pages.
 */
export function captureScale(clip: { width: number; height: number }, devicePixelRatio = 1): number {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const pixels = clip.width * clip.height * ratio * ratio;
  return pixels > MAX_CAPTURE_PIXELS ? Math.sqrt(MAX_CAPTURE_PIXELS / pixels) : 1;
}

/**
 * An element's box clipped to the document and rounded outwards to whole pixels; null when nothing
 * of it is inside the document (hidden, zero-sized).
 */
export function elementClip(rect: CaptureRect, page: { width: number; height: number }): CaptureRect | null {
  const left = Math.max(0, Math.floor(rect.x));
  const top = Math.max(0, Math.floor(rect.y));
  const right = Math.min(page.width, Math.ceil(rect.x + rect.width));
  const bottom = Math.min(page.height, Math.ceil(rect.y + rect.height));
  if (right - left < 1 || bottom - top < 1) return null;
  return { x: left, y: top, width: Math.min(MAX_CAPTURE_SIZE, right - left), height: Math.min(MAX_CAPTURE_SIZE, bottom - top) };
}

/** A rectangle as a page script returned it (untrusted: the page shares the DOM). */
export function isCaptureRect(value: unknown): value is CaptureRect {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (["x", "y", "width", "height"] as const).every((key) => typeof r[key] === "number" && Number.isFinite(r[key]));
}

/** The recording timer: `0:05`, `12:34`, `1:02:03`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
