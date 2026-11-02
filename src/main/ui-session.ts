import { session, type Session, type WebContents } from "electron";

/**
 * The browser UI's own session (chrome and overlay, ADR-024): in memory and separate from every
 * tab session, so what is installed into tab sessions never reaches the UI and its preload API.
 * Extensions in particular: Electron refuses to load any into an in-memory session, and the ones
 * of the default session, although Chromium lists them there too (this is its "incognito" side),
 * never run in it (no extension is allowed in incognito; checked by the e2e test). Nothing is
 * stored there: the UI keeps no cookies nor web storage. Its only permissions are writing to the
 * clipboard (copying the sync pairing code) and, while main waits for it, the display capture of the
 * tab being recorded (ADR-031; the display-media handler in ./capture/record.ts names the source).
 */
let ui: Session | null = null;

/** Whether `contents` (a chrome UI) is expected to call `getDisplayMedia` now. */
let displayCaptureGate: (contents: WebContents) => boolean = () => false;

export function setDisplayCaptureGate(gate: (contents: WebContents) => boolean): void {
  displayCaptureGate = gate;
}

export function uiSession(): Session {
  if (ui) return ui;
  ui = session.fromPartition("browser-ui");
  const allowed = (permission: string) => permission === "clipboard-sanitized-write";
  ui.setPermissionRequestHandler((contents, permission, callback, details) => {
    // Display capture asks for "media" without camera nor microphone types.
    const displayCapture = permission === "media" && !("mediaTypes" in details && details.mediaTypes?.length) && displayCaptureGate(contents);
    callback(allowed(permission) || displayCapture);
  });
  ui.setPermissionCheckHandler((_contents, permission) => allowed(permission));
  ui.on("will-download", (event) => event.preventDefault());
  return ui;
}
