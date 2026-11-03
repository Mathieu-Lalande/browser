import { app, session, shell, type Session, type WebContents } from "electron";
import { isLocalFileUrl, isNavigableUrl, isPageOpenableUrl } from "@shared/url";
import { UserActivation, isActivatingInput, isPeekGesture } from "./activation";
import { appServices } from "./app-services-ref";
import type { SessionOptions } from "./services";

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

/**
 * Hardening of a session tabs can use, applied once the app is ready (after the profile is open):
 * the default session, the partition of each isolated space before its first tab is created, and
 * each private window's in-memory partition (`ephemeral`). Idempotent (once per session): every
 * session service (privacy, downloads, extensions, certificates) is installed by `SessionHardener`.
 */
export function hardenSession(ses: Session = session.defaultSession, options: SessionOptions = {}): Session {
  return appServices().hardener.harden(ses, options);
}

/** Forgets a session that is going away (a private window closed): every session service releases it. */
export function releaseSession(ses: Session): void {
  appServices().hardener.release(ses);
}

interface TabHooks {
  openTab(url: string, foreground: boolean): void;
  /** A page tried to open `url` without a recent user gesture (the popup blocker said no). */
  popupBlocked(url: string): void;
  /** A Shift+click on a link (trusted input): preview it in the link peek (ADR-027). Absent: a new tab. */
  peek?(url: string): void;
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

  // Popup blocker (ADR-018): what counts is trusted input main sees reaching the page, not the
  // page's own claims (`disposition` follows modifiers a script can put on a synthetic click).
  // Touch input reaches pages as mouse/gesture events here.
  contents.on("before-mouse-event", (_event, mouse) => {
    if (isActivatingInput(mouse)) tab.activation.record(Date.now(), isPeekGesture(mouse));
  });
  contents.on("before-input-event", (_event, input) => {
    if (isActivatingInput(input)) tab.activation.record(Date.now());
  });

  contents.setWindowOpenHandler(({ url, disposition, features }) => {
    // Never a top-level data: (or any non-web) document opened by a page.
    if (isPageOpenableUrl(url)) {
      // Chromium opens a Shift+clicked link as a new window without features (window.open with
      // features, e.g. a sign-in popup, keeps opening a tab); the click itself was a real one.
      if (disposition === "new-window" && !features && tab.hooks.peek && tab.activation.consumePeek(Date.now())) tab.hooks.peek(url);
      else if (tab.activation.consumeOpen(Date.now())) tab.hooks.openTab(url, disposition !== "background-tab");
      else tab.hooks.popupBlocked(url);
    } else if (isExternalUrl(url) && tab.activation.consumeExternal(Date.now())) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  contents.on("will-navigate", (event, url) => {
    if (isNavigableUrl(url)) return;
    // A local file the OS handed over (ADR-039) may link to its neighbours, never a web page to a file.
    if (isLocalFileUrl(url) && isLocalFileUrl(contents.getURL())) return;
    event.preventDefault();
    if (isExternalUrl(url) && tab.activation.consumeExternal(Date.now())) void shell.openExternal(url);
  });
  contents.on("will-redirect", (event, url) => {
    if (!isNavigableUrl(url)) event.preventDefault();
  });
}
