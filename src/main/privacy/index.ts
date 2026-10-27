import { join } from "node:path";
import { app, session, type Session, type WebContents } from "electron";
import type { PermissionKind, PermissionPrompt } from "@shared/types";
import { normalizeClientHints } from "../fingerprint";
import { ContentBlocker } from "./blocker";
import { TabCosmetics } from "./cosmetics";
import { webHostname } from "@shared/hosts";
import { APP_SCHEME } from "../app-files";
import { HttpsOnly } from "@shared/https-only";
import { flushJsonWriters } from "./json-file";
import { PermissionStore } from "./permission-store";
import { PermissionPrompts, permissionKinds } from "./permissions";
import { ShieldsAllowList } from "./shields";
import { settings } from "../settings";
import { stripsCookies, withoutHeaders } from "../site-info/domains";

/** What a tab wants to hear about from the privacy layer. */
export interface TabPrivacyHooks {
  /** One of the tab's requests was blocked. */
  blocked(): void;
  /** The permission prompt to show for the tab changed. */
  permissionChanged(prompt: PermissionPrompt | null): void;
}

interface PrivacyState {
  shields: ShieldsAllowList;
  blocker: ContentBlocker;
  https: HttpsOnly;
  prompts: PermissionPrompts;
}

/**
 * What an ephemeral (private window) session keeps to itself instead of sharing it with the
 * profile: permission decisions and shields toggles live in memory, for the window's lifetime.
 */
interface EphemeralState {
  prompts: PermissionPrompts;
  /** Hostname → shields enabled, overriding the profile's allow-list without ever writing it. */
  shields: Map<string, boolean>;
}

/**
 * Tab pages known to the privacy layer. `documentUrl` is the page their subresources belong to:
 * the main-frame URL last requested, then the committed one. `contents.getURL()` alone lags behind:
 * a new page can request its subresources before main has seen it commit, and they would then be
 * judged against the previous page (or none at all, letting them through).
 * Only tab pages are filtered: requests from anything else (the chrome UI, the main process)
 * are never blocked, upgraded or modified.
 */
const tabs = new Map<
  number,
  { contents: WebContents; hooks: TabPrivacyHooks; prompts: PermissionPrompts; documentUrl?: string }
>();
let privacy: PrivacyState | undefined;
const ephemeral = new WeakMap<Session, EphemeralState>();
const shieldsListeners = new Set<() => void>();

/** Lists are downloaded in a separate in-memory session, outside the filtered default one. */
async function fetchList(url: string): Promise<string> {
  const response = await session.fromPartition("privacy-lists").fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

/** The shared privacy state (lists, exceptions, prompts), created with the first hardened session. */
function privacyState(): PrivacyState {
  if (privacy) return privacy;
  const dir = app.getPath("userData");
  const state: PrivacyState = {
    shields: new ShieldsAllowList(join(dir, "shields.json")),
    // `BROWSER_TEST_FILTERS` (e2e tests) is a dev hook: a packaged app ignores it (ADR-018).
    blocker: new ContentBlocker(join(dir, "adblock", "engine.bin"), fetchList, app.isPackaged ? undefined : process.env.BROWSER_TEST_FILTERS),
    https: new HttpsOnly(),
    prompts: promptsWith(new PermissionStore(join(dir, "permissions.json"))),
  };
  privacy = state;
  state.blocker.start();
  app.once("will-quit", () => {
    state.blocker.stop();
    // Shields toggles and remembered permissions saved just before quitting reach the disk too.
    flushJsonWriters();
  });
  return state;
}

function promptsWith(store: PermissionStore): PermissionPrompts {
  const prompts: PermissionPrompts = new PermissionPrompts(store, (id) => tabs.get(id)?.hooks.permissionChanged(prompts.current(id)));
  return prompts;
}

/** Permission prompts of the session a tab page belongs to. */
function promptsOf(ses: Session): PermissionPrompts {
  return ephemeral.get(ses)?.prompts ?? privacyState().prompts;
}

/** Whether the shields apply to `host` in `ses` (a private window's own toggles first). */
function shieldsOn(ses: Session | undefined, host: string): boolean {
  const own = ses ? ephemeral.get(ses)?.shields.get(host) : undefined;
  return own ?? privacy?.shields.isEnabled(host) ?? true;
}

/** Sessions already filtered: `webRequest` accepts one listener per event, so install only once. */
const installed = new WeakSet<Session>();

export interface PrivacyOptions {
  /**
   * A private window's session: permission decisions and shields toggles stay in memory and are
   * never shared with the profile nor written to disk ("Se souvenir" is ignored).
   */
  ephemeral?: boolean;
}

/**
 * Installs the shields on a session: content blocking, HTTPS-Only, Global Privacy Control,
 * client hints normalization and per-site permission prompts. `alwaysAllowed` permissions are
 * granted without asking. Every session tabs use (the default one, isolated spaces' partitions,
 * private windows) goes through here; the filter engine and HTTPS exceptions are shared by all of
 * them, and so are permission decisions and shields toggles, except for ephemeral sessions. Idempotent.
 */
export function installPrivacy(ses: Session, alwaysAllowed: ReadonlySet<string>, options: PrivacyOptions = {}): void {
  if (installed.has(ses)) return;
  installed.add(ses);
  const state = privacyState();
  if (options.ephemeral) ephemeral.set(ses, { prompts: promptsWith(new PermissionStore(null)), shields: new Map() });
  const prompts = promptsOf(ses);

  ses.webRequest.onBeforeRequest((details, callback) => {
    const tab = details.webContentsId === undefined ? undefined : tabs.get(details.webContentsId);
    if (!tab) return callback({});
    // The browser's own UI scheme is never reachable from a page, not even as a subresource (ADR-018).
    if (details.url.startsWith(`${APP_SCHEME}:`)) return callback({ cancel: true });
    if (details.resourceType === "mainFrame") {
      const upgraded = state.https.upgrade(tab.contents.id, details.url);
      tab.documentUrl = upgraded ?? details.url;
      return callback(upgraded ? { redirectURL: upgraded } : {});
    }
    const pageUrl = tab.documentUrl || tab.contents.getURL();
    const host = webHostname(pageUrl);
    if (!host || !shieldsOn(ses, host)) return callback({});
    const verdict = state.blocker.match(details.url, details.resourceType, pageUrl);
    if (!verdict) return callback({});
    tab.hooks.blocked();
    callback(verdict.redirectUrl ? { redirectURL: verdict.redirectUrl } : { cancel: true });
  });

  /** The page a tab's request belongs to (see `tabs`), for third-party checks. */
  const pageOf = (tab: { contents: WebContents; documentUrl?: string }) => tab.documentUrl || tab.contents.getURL();

  // `webRequest` takes one listener per event and session: third-party cookie blocking (ADR-021)
  // lives in the same listeners as the rest of the pipeline.
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const tab = details.webContentsId === undefined ? undefined : tabs.get(details.webContentsId);
    if (!tab) return callback({});
    // Global Privacy Control: a legally meaningful "do not sell/share" signal in several jurisdictions.
    // Client hints (Sec-CH-UA*) are made consistent with the reduced user agent (ADR-014).
    let headers: Record<string, string> = { ...normalizeClientHints(details.requestHeaders, app.getName()), "Sec-GPC": "1" };
    if (stripsCookies(details.url, pageOf(tab), details.resourceType, settings().privacy)) headers = withoutHeaders(headers, ["cookie"]);
    callback({ requestHeaders: headers });
  });

  ses.webRequest.onHeadersReceived((details, callback) => {
    const tab = details.webContentsId === undefined ? undefined : tabs.get(details.webContentsId);
    if (!tab || !details.responseHeaders || !stripsCookies(details.url, pageOf(tab), details.resourceType, settings().privacy)) return callback({});
    callback({ responseHeaders: withoutHeaders(details.responseHeaders, ["set-cookie"]) });
  });

  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (alwaysAllowed.has(permission)) return callback(true);
    const kinds = permissionKinds(permission, "mediaTypes" in details ? (details.mediaTypes ?? []) : []);
    if (!kinds || !tabs.has(contents.id)) return callback(false);
    // Decisions are keyed by (requesting origin, top-level origin): an embedded frame allowed
    // inside one site is not allowed inside every site embedding it (ADR-018).
    prompts.request(contents.id, details.requestingUrl || contents.getURL(), kinds, callback, contents.getURL());
  });
  ses.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    if (alwaysAllowed.has(permission)) return true;
    if (!contents || !tabs.has(contents.id)) return false;
    const kinds = permissionKinds(permission, details.mediaType ? [details.mediaType] : []);
    return kinds !== null && prompts.check(requestingOrigin, kinds, contents.getURL());
  });
}

/**
 * Registers a tab page with the privacy layer, for as long as its webContents lives. Calling it
 * again (a live tab moved to another space) only replaces `hooks`.
 */
export function attachTabPrivacy(contents: WebContents, hooks: TabPrivacyHooks): void {
  const id = contents.id;
  const known = tabs.get(id);
  if (known) return void (known.hooks = hooks);
  const prompts = promptsOf(contents.session);
  tabs.set(id, { contents, hooks, prompts });
  // WebRTC must not reveal local network addresses to pages.
  contents.setWebRTCIPHandlingPolicy("default_public_interface_only");

  contents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) prompts.denyAll(id);
  });
  contents.on("did-navigate", () => privacy?.https.clear(id));
  // Back to the committed page once loading settles (a main-frame request may not have committed: download, 204…).
  contents.on("did-stop-loading", () => {
    const tab = tabs.get(id);
    if (tab) tab.documentUrl = contents.getURL();
  });
  if (privacy) {
    // Element hiding, driven from main (ADR-006); listens to the tab's events for its lifetime.
    const ses = contents.session;
    new TabCosmetics(contents, privacy.blocker, (url) => {
      const host = webHostname(url);
      return !!host && shieldsOn(ses, host);
    });
  }
  contents.once("destroyed", () => {
    tabs.delete(id);
    prompts.denyAll(id);
    privacy?.https.clear(id);
  });
}

/** Whether `contents` is a tab page (registered by `attachTabPrivacy`), as opposed to browser UI. */
export function isTabPage(contents: WebContents): boolean {
  return tabs.get(contents.id)?.contents === contents;
}

/**
 * Whether content blocking applies to this page (always true for non-web pages: nothing to toggle).
 * `ses`: the tab's session (default session when omitted), for private windows' own toggles.
 */
export function shieldsEnabledFor(url: string, ses?: Session): boolean {
  const host = webHostname(url);
  return !host || shieldsOn(ses, host);
}

/** Turns the shields on/off for the URL's host: saved in the profile, or in memory for a private window. */
export function setShieldsEnabled(url: string, enabled: boolean, ses?: Session): void {
  const host = webHostname(url);
  if (!host) return;
  const own = ses && ephemeral.get(ses);
  if (own) {
    own.shields.set(host, enabled);
    for (const listener of [...shieldsListeners]) listener();
  } else {
    void privacy?.shields.setEnabled(host, enabled);
  }
}

export function onShieldsChange(listener: () => void): () => void {
  shieldsListeners.add(listener);
  const unsubscribe = privacy?.shields.onChange(listener);
  return () => {
    shieldsListeners.delete(listener);
    unsubscribe?.();
  };
}

/**
 * The URL to fetch a tab page's favicon from, or null when its own pipeline would not load it: the
 * shields block it for that page, or it is not a web URL. HTTPS-Only upgrades it like a navigation
 * (main fetches favicons itself, outside `webRequest`'s view of the tab: ADR-018).
 */
export function faviconRequestUrl(contents: WebContents, iconUrl: string, pageUrl: string): string | null {
  if (!/^https?:/i.test(iconUrl)) return null;
  const host = webHostname(pageUrl);
  if (privacy && host && shieldsOn(contents.session, host) && privacy.blocker.match(iconUrl, "image", pageUrl)) return null;
  return privacy?.https.upgradeFor(iconUrl) ?? iconUrl;
}

/** HTTPS-Only: the http:// URL to offer when a tab's upgraded load failed, else null. */
export function httpsFallbackFor(contentsId: number, failedUrl: string, code: number): string | null {
  return privacy?.https.fallbackFor(contentsId, failedUrl, code) ?? null;
}

/** HTTPS-Only exception for the URL's host, until the browser quits. */
export function allowHttp(url: string): void {
  privacy?.https.allowHttp(url);
}

/** Permission decisions on the top-level site `topOrigin`, in `ses` (a private window's own). */
export function sitePermissions(ses: Session, topOrigin: string): ReturnType<PermissionStore["entriesFor"]> {
  return promptsOf(ses).store.entriesFor(topOrigin);
}

/** Forgets one decision: the site (or the frame embedded in it) will ask again. */
export function forgetSitePermission(ses: Session, origin: string, kind: PermissionKind, topOrigin: string): void {
  void promptsOf(ses).store.forget(origin, kind, topOrigin);
}

export function respondPermission(contentsId: number, promptId: string, allow: boolean, remember: boolean): void {
  tabs.get(contentsId)?.prompts.respond(contentsId, promptId, allow, remember);
}
