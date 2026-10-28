import { session, type Session } from "electron";

/**
 * The browser UI's own session (chrome and overlay, ADR-024): in memory and separate from every
 * tab session, so what is installed into tab sessions never reaches the UI and its preload API.
 * Extensions in particular: Electron refuses to load any into an in-memory session, and the ones
 * of the default session, although Chromium lists them there too (this is its "incognito" side),
 * never run in it (no extension is allowed in incognito; checked by the e2e test). Nothing is
 * stored there: the UI keeps no cookies nor web storage. Its only permission is writing to the
 * clipboard (copying the sync pairing code).
 */
let ui: Session | null = null;

export function uiSession(): Session {
  if (ui) return ui;
  ui = session.fromPartition("browser-ui");
  const allowed = (permission: string) => permission === "clipboard-sanitized-write";
  ui.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed(permission)));
  ui.setPermissionCheckHandler((_contents, permission) => allowed(permission));
  ui.on("will-download", (event) => event.preventDefault());
  return ui;
}
