import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { app, protocol, session } from "electron";
import { APP_SCHEME, CHROME_PAGE, OVERLAY_PAGE, mimeTypeOf, resolveAppFile } from "./app-files";

/**
 * The browser's own UI (chrome and overlay) is served from `app://browser/…` instead of `file://`
 * (ADR-018): the `grantFileProtocolExtraPrivileges` fuse is off, and a custom standard scheme gives
 * the UI a real origin (`'self'` in its CSP) without any file:// rights. Only files of the renderer
 * bundle are served. Tab pages can neither navigate to it (`isNavigableUrl`) nor request it (the
 * privacy pipeline cancels their app:// requests).
 */

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
  ]);
}

/** Serves the renderer bundle on the default session (where the chrome UI and the overlay live). */
export function serveAppScheme(): void {
  const root = join(import.meta.dirname, "../renderer");
  session.defaultSession.protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveAppFile(root, request.url);
    const type = file && mimeTypeOf(file);
    if (!file || !type) return new Response("Not found", { status: 404 });
    try {
      return new Response(await readFile(file), { headers: { "content-type": type, "x-content-type-options": "nosniff" } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

/**
 * Where the chrome UI (or the overlay) loads from: the bundle, or the Vite dev server in
 * development only — a packaged app never honors `ELECTRON_RENDERER_URL` (audit MEDIUM-2).
 */
export function uiUrl(page: "index" | "overlay"): string {
  const dev = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
  if (dev) return page === "index" ? dev : `${dev}/overlay.html`;
  return page === "index" ? CHROME_PAGE : OVERLAY_PAGE;
}
