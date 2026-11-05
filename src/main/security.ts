import { app, session, shell, type BrowserWindowConstructorOptions, type Session, type WebContents, type WebPreferences } from "electron";
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

/**
 * What every tab's page runs with (`TabManager` views, popups adopted as tabs). Electron merges it
 * over what a `window.open` page inherits from its opener, whatever its features string asks.
 */
export const TAB_WEB_PREFERENCES: WebPreferences = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  spellcheck: true,
  // Chromium's built-in PDF viewer (ADR-039): a component extension in its own sandboxed
  // process; no other plugin exists in Electron. Attachments still download.
  plugins: true,
};

/** What `createWindow` receives: the page Chromium created for `window.open` (missing from the typings). */
export type PopupOptions = BrowserWindowConstructorOptions & { webContents?: WebContents };

interface TabHooks {
  openTab(url: string, foreground: boolean): void;
  /**
   * A popup the gesture allowed: wraps the page Chromium created for it (`options.webContents`,
   * which keeps `window.opener`, its name and `window.close()`) in a tab next to the opener and
   * returns it. Absent (link peek): the URL opens in a fresh tab, without opener.
   */
  adoptPopup?(options: PopupOptions, url: string, foreground: boolean): WebContents;
  /** A page tried to open `url` without a recent user gesture (the popup blocker said no). */
  popupBlocked(url: string): void;
  /** A Shift+click on a link (trusted input): preview it in the link peek (ADR-027). Absent: a new tab. */
  peek?(url: string): void;
}

/** Schemes handed to the OS (mail and phone apps), after a user gesture only. */
const isExternalUrl = (url: string) => /^(mailto|tel):/i.test(url);
const isGoogleAuthenticationUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "accounts.google.com";
  } catch {
    return false;
  }
};

function openExternal(url: string): void {
  void shell.openExternal(url).catch((error: unknown) => {
    console.warn("[security] Could not open the external authentication page:", error);
  });
}

/** Room for every feature's pending isolated-world scripts on one page (see `hardenWebContents`). */
const MAX_TAB_LISTENERS = 50;

const hardenedContents = new WeakMap<WebContents, { hooks: TabHooks; activation: UserActivation }>();

/**
 * Per-tab rules: popups become tabs (after a user gesture only), pages can only navigate to web
 * schemes, and mail/phone links reach the OS only right after a user gesture, once every few
 * seconds. Calling it again (a live tab moved to another space) only replaces `hooks`.
 */
export function hardenWebContents(contents: WebContents, hooks: TabHooks): void {
  const known = hardenedContents.get(contents);
  if (known) return void (known.hooks = hooks);
  void contents.setVisualZoomLevelLimits(0.25, 5).catch((error: unknown) =>
    console.warn("[security] Could not enable page pinch zoom:", error),
  );
  const tab = { hooks, activation: new UserActivation() };
  hardenedContents.set(contents, tab);
  // Not a leak: each feature's isolated-world script (cosmetics, passwords, autofill, notes, media,
  // translation…) runs at dom-ready, and Electron parks every `executeJavaScriptInIsolatedWorld`
  // made while the page loads on a one-shot `did-stop-loading` listener. More than 10 at once is
  // expected, so the default warning threshold would fire on every page load.
  contents.setMaxListeners(MAX_TAB_LISTENERS);

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
    if (isGoogleAuthenticationUrl(url)) {
      openExternal(url);
      return { action: "deny" };
    }
    // Never a top-level data: (or any non-web) document opened by a page.
    if (isPageOpenableUrl(url)) {
      // Chromium opens a Shift+clicked link as a new window without features (window.open with
      // features, e.g. a sign-in popup, keeps opening a tab); the click itself was a real one.
      if (disposition === "new-window" && !features && tab.hooks.peek && tab.activation.consumePeek(Date.now())) tab.hooks.peek(url);
      else if (tab.activation.consumeOpen(Date.now())) {
        const foreground = disposition !== "background-tab";
        const adopt = tab.hooks.adoptPopup;
        if (!adopt) tab.hooks.openTab(url, foreground);
        // A real popup (SSO sign-ins): its page keeps the opener (postMessage, opener.location),
        // its name and `window.close()`; Chromium itself leaves `noopener` links without opener.
        // Never a native window: the page always becomes a tab, with the tabs' preferences.
        else
          return {
            action: "allow",
            outlivesOpener: true,
            overrideBrowserWindowOptions: { webPreferences: TAB_WEB_PREFERENCES },
            createWindow: (options) => adopt(options, url, foreground),
          };
      } else tab.hooks.popupBlocked(url);
    } else if (isExternalUrl(url) && tab.activation.consumeExternal(Date.now())) openExternal(url);
    return { action: "deny" };
  });

  contents.on("will-navigate", (event, url) => {
    if (isGoogleAuthenticationUrl(url)) {
      event.preventDefault();
      openExternal(url);
      return;
    }
    if (isNavigableUrl(url)) return;
    // A local file the OS handed over (ADR-039) may link to its neighbours, never a web page to a file.
    if (isLocalFileUrl(url) && isLocalFileUrl(contents.getURL())) return;
    event.preventDefault();
    if (isExternalUrl(url) && tab.activation.consumeExternal(Date.now())) openExternal(url);
  });
  contents.on("will-redirect", (event, url) => {
    if (!isNavigableUrl(url)) event.preventDefault();
  });
}
