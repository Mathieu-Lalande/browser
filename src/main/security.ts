import { app, session, shell, type Session, type WebContents } from "electron";
import { isNavigableUrl, isPageOpenableUrl } from "@shared/url";
import { UserActivation, isActivatingInput } from "./activation";
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
  // `--no-sandbox` is only for environments where the OS sandbox cannot start (CI, containers as
  // root, some Linux distributions without user namespaces). Kept working when packaged, but said.
  if (!app.commandLine.hasSwitch("no-sandbox")) app.enableSandbox();
  else if (app.isPackaged) console.warn("[security] --no-sandbox: web pages run without the OS sandbox. Use it only if the sandbox cannot start.");

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
  /** A page tried to open `url` without a recent user gesture (the popup blocker said no). */
  popupBlocked(url: string): void;
}

/** Schemes handed to the OS (mail and phone apps), after a user gesture only. */
const isExternalUrl = (url: string) => /^(mailto|tel):/i.test(url);

const hardenedContents = new WeakMap<WebContents, { hooks: TabHooks; activation: UserActivation }>();

/**
 * Per-tab rules: popups become tabs (after a user gesture only), pages can only navigate to web
 * schemes, and mail/phone links reach the OS only right after a user gesture, once every few
 * seconds. Calling it again (a live tab moved to another space) only replaces `hooks`.
 */
export function hardenWebContents(contents: WebContents, hooks: TabHooks): void {
  const known = hardenedContents.get(contents);
  if (known) return void (known.hooks = hooks);
  const tab = { hooks, activation: new UserActivation() };
  hardenedContents.set(contents, tab);

  // Popup blocker (ADR-017): what counts is trusted input main sees reaching the page, not the
  // page's own claims (`disposition` follows modifiers a script can put on a synthetic click).
  // Touch input reaches pages as mouse/gesture events here.
  contents.on("before-mouse-event", (_event, mouse) => {
    if (isActivatingInput(mouse)) tab.activation.record(Date.now());
  });
  contents.on("before-input-event", (_event, input) => {
    if (isActivatingInput(input)) tab.activation.record(Date.now());
  });

  contents.setWindowOpenHandler(({ url, disposition }) => {
    // Never a top-level data: (or any non-web) document opened by a page.
    if (isPageOpenableUrl(url)) {
      if (tab.activation.consumeOpen(Date.now())) tab.hooks.openTab(url, disposition !== "background-tab");
      else tab.hooks.popupBlocked(url);
    } else if (isExternalUrl(url) && tab.activation.consumeExternal(Date.now())) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  contents.on("will-navigate", (event, url) => {
    if (isNavigableUrl(url)) return;
    event.preventDefault();
    if (isExternalUrl(url) && tab.activation.consumeExternal(Date.now())) void shell.openExternal(url);
  });
  contents.on("will-redirect", (event, url) => {
    if (!isNavigableUrl(url)) event.preventDefault();
  });
}
