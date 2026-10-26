import { app, session, shell, type Session, type WebContents } from "electron";
import { isNavigableUrl } from "@shared/url";
import { installDownloads } from "./downloads";
import { installPrivacy } from "./privacy";

/**
 * Permissions granted without asking. Sensitive ones (camera, location…) are asked per site through
 * the permission bar; everything else is denied (see `src/main/privacy/permissions.ts`).
 */
const ALLOWED_PERMISSIONS = new Set(["fullscreen", "clipboard-sanitized-write", "pointerLock"]);

/** Process-wide hardening, applied once before any window is created. */
export function hardenApp(): void {
  // `--no-sandbox` is only for environments where the OS sandbox cannot start (CI, containers as root).
  if (!app.commandLine.hasSwitch("no-sandbox")) app.enableSandbox();

  app.on("web-contents-created", (_event, contents) => {
    // No page may create <webview> tags, the chrome UI included.
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
}

const hardened = new WeakSet<Session>();

/**
 * Hardening of a session tabs can use, applied once the app is ready: the default session, and the
 * partition of each isolated space before its first tab is created. Idempotent (once per session).
 */
export function hardenSession(ses: Session = session.defaultSession): Session {
  if (hardened.has(ses)) return ses;
  hardened.add(ses);
  // Content blocking, HTTPS-Only, Global Privacy Control and per-site permission prompts.
  installPrivacy(ses, ALLOWED_PERMISSIONS);
  // Downloads: tab pages only, no automatic opening, dangerous types confirmed first (ADR-013).
  installDownloads(ses);
  // A desktop-Chrome-like user agent: the default one advertises Electron and the app name,
  // which both breaks sites and makes users easier to fingerprint.
  const appToken = app.getName().replace(/[^\w-]/g, "");
  ses.setUserAgent(ses.getUserAgent().replace(new RegExp(`\\s(${appToken}|Electron)/\\S+`, "gi"), ""));
  return ses;
}

interface TabHooks {
  openTab(url: string, foreground: boolean): void;
}

const hardenedContents = new WeakSet<WebContents>();

/**
 * Per-tab rules: popups become tabs, and pages can only navigate to web schemes. Calling it again
 * (a live tab moved to another space) only replaces `hooks`.
 */
export function hardenWebContents(contents: WebContents, hooks: TabHooks): void {
  contents.setWindowOpenHandler(({ url, disposition }) => {
    if (isNavigableUrl(url)) hooks.openTab(url, disposition !== "background-tab");
    else if (/^mailto:|^tel:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  if (hardenedContents.has(contents)) return;
  hardenedContents.add(contents);

  contents.on("will-navigate", (event, url) => {
    if (isNavigableUrl(url)) return;
    event.preventDefault();
    if (/^mailto:|^tel:/i.test(url)) void shell.openExternal(url);
  });
  contents.on("will-redirect", (event, url) => {
    if (!isNavigableUrl(url)) event.preventDefault();
  });
}
