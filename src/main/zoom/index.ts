import type { Session } from "electron";
import { webHostname } from "@shared/hosts";
import { isPrivateSession } from "../private";
import { profile } from "../profile";
import { sameFactor } from "./levels";

/**
 * Per-site zoom, remembered by host in `zoom.json` and shared by every window (and, later, every
 * space's session: Chromium only propagates zoom between pages of the same session itself).
 * A private window (ADR-014) starts from the remembered levels but keeps its own changes in
 * memory: nothing it zooms is written to `zoom.json`.
 */

type Listener = (host: string) => void;
const listeners = new Set<Listener>();
/** Private sessions' own levels (host → factor), for the window's lifetime. */
const privateLevels = new WeakMap<Session, Map<string, number>>();

/** The zoom factor for `url`, or undefined for pages without a web host (data:, about:…). */
export function siteZoomFactor(url: string, defaultFactor: number, ses?: Session): number | undefined {
  const host = webHostname(url);
  if (!host) return undefined;
  return (ses && privateLevels.get(ses)?.get(host)) ?? profile().zoom.factorFor(host, defaultFactor);
}

/** Remembers the zoom chosen on `url`'s site; listeners re-apply it to that site's other tabs. */
export function rememberSiteZoom(url: string, factor: number, defaultFactor: number, ses?: Session): void {
  const host = webHostname(url);
  if (!host) return;
  if (ses && isPrivateSession(ses)) {
    let levels = privateLevels.get(ses);
    if (!levels) privateLevels.set(ses, (levels = new Map()));
    const previous = levels.get(host) ?? profile().zoom.factorFor(host, defaultFactor);
    levels.set(host, factor);
    if (sameFactor(previous, factor)) return;
  } else {
    const { zoom, saveZoom } = profile();
    if (!zoom.set(host, factor, defaultFactor)) return;
    saveZoom();
  }
  for (const listener of listeners) listener(host);
}

export function onSiteZoomChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
