import { app, session, shell, type Session, type WebContents } from "electron";
import { isNavigableUrl } from "@shared/url";
import { installDownloads } from "./downloads";
import { acceptLanguages, reduceUserAgent } from "./fingerprint";
import { installPrivacy, type PrivacyOptions } from "./privacy";
import { onSettingsChanged, settings } from "./settings";

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

/** Hardened sessions → their reduced user agent (re-applied with new languages when settings change). */
const hardened = new Map<Session, string>();

/** User agent and `Accept-Language` of a session, following the "normalize languages" setting. */
function applyIdentity(ses: Session, userAgent: string): void {
  ses.setUserAgent(userAgent, acceptLanguages(settings().privacy.normalizeAcceptLanguage, app.getLocale()));
}

let languagesFollowSettings = false;

/**
 * Hardening of a session tabs can use, applied once the app is ready (after the profile is open):
 * the default session, the partition of each isolated space before its first tab is created, and
 * each private window's in-memory partition (`ephemeral`). Idempotent (once per session).
 */
export function hardenSession(ses: Session = session.defaultSession, options: PrivacyOptions = {}): Session {
  if (hardened.has(ses)) return ses;
  // Content blocking, HTTPS-Only, Global Privacy Control, client hints and per-site permission prompts.
  installPrivacy(ses, ALLOWED_PERMISSIONS, options);
  // Downloads: tab pages only, no automatic opening, dangerous types confirmed first (ADR-013).
  // A private session's downloads are not recorded in the downloads history (ADR-014).
  installDownloads(ses, { ephemeral: options.ephemeral });
  // A desktop-Chrome-like user agent: the default one advertises Electron and the app name,
  // which both breaks sites and makes users easier to fingerprint (ADR-014).
  const userAgent = reduceUserAgent(ses.getUserAgent(), app.getName());
  hardened.set(ses, userAgent);
  applyIdentity(ses, userAgent);
  if (!languagesFollowSettings) {
    languagesFollowSettings = true;
    let normalize = settings().privacy.normalizeAcceptLanguage;
    onSettingsChanged((current) => {
      if (current.privacy.normalizeAcceptLanguage === normalize) return;
      normalize = current.privacy.normalizeAcceptLanguage;
      for (const [known, agent] of hardened) applyIdentity(known, agent);
    });
  }
  return ses;
}

/** Forgets a session that is going away (a private window closed). */
export function releaseSession(ses: Session): void {
  hardened.delete(ses);
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
