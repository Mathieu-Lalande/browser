import { webHostname } from "@shared/hosts";
import { profile } from "../profile";

/**
 * Per-site zoom, remembered by host in `zoom.json` and shared by every window (and, later, every
 * space's session: Chromium only propagates zoom between pages of the same session itself).
 */

type Listener = (host: string) => void;
const listeners = new Set<Listener>();

/** The zoom factor for `url`, or undefined for pages without a web host (data:, about:…). */
export function siteZoomFactor(url: string, defaultFactor: number): number | undefined {
  const host = webHostname(url);
  return host ? profile().zoom.factorFor(host, defaultFactor) : undefined;
}

/** Remembers the zoom chosen on `url`'s site; listeners re-apply it to that site's other tabs. */
export function rememberSiteZoom(url: string, factor: number, defaultFactor: number): void {
  const host = webHostname(url);
  if (!host) return;
  const { zoom, saveZoom } = profile();
  if (!zoom.set(host, factor, defaultFactor)) return;
  saveZoom();
  for (const listener of listeners) listener(host);
}

export function onSiteZoomChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
