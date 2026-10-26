import { join } from "node:path";
import { app, session, type Session, type WebContents } from "electron";
import type { PermissionPrompt } from "@shared/types";
import { ContentBlocker } from "./blocker";
import { TabCosmetics } from "./cosmetics";
import { webHostname } from "./hosts";
import { HttpsOnly } from "./https-only";
import { PermissionStore } from "./permission-store";
import { PermissionPrompts, permissionKinds } from "./permissions";
import { ShieldsAllowList } from "./shields";

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
 * Only tab pages are filtered: requests from anything else (the chrome UI, the main process)
 * are never blocked, upgraded or modified.
 */
const tabs = new Map<number, { contents: WebContents; hooks: TabPrivacyHooks }>();
let privacy: PrivacyState | undefined;

/** Lists are downloaded in a separate in-memory session, outside the filtered default one. */
async function fetchList(url: string): Promise<string> {
  const response = await session.fromPartition("privacy-lists").fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

/**
 * Installs the shields on a session: content blocking, HTTPS-Only, Global Privacy Control and
 * per-site permission prompts. `alwaysAllowed` permissions are granted without asking.
 */
export function installPrivacy(ses: Session, alwaysAllowed: ReadonlySet<string>): void {
  const dir = app.getPath("userData");
  const state: PrivacyState = {
    shields: new ShieldsAllowList(join(dir, "shields.json")),
    blocker: new ContentBlocker(join(dir, "adblock", "engine.bin"), fetchList),
    https: new HttpsOnly(),
    prompts: new PermissionPrompts(new PermissionStore(join(dir, "permissions.json")), (id) =>
      tabs.get(id)?.hooks.permissionChanged(state.prompts.current(id)),
    ),
  };
  privacy = state;
  state.blocker.start();
  app.once("will-quit", () => state.blocker.stop());

  ses.webRequest.onBeforeRequest((details, callback) => {
    const tab = details.webContentsId === undefined ? undefined : tabs.get(details.webContentsId);
    if (!tab) return callback({});
    if (details.resourceType === "mainFrame") {
      const upgraded = state.https.upgrade(tab.contents.id, details.url);
      return callback(upgraded ? { redirectURL: upgraded } : {});
    }
    const pageUrl = tab.contents.getURL();
    const host = webHostname(pageUrl);
    if (!host || !state.shields.isEnabled(host)) return callback({});
    const verdict = state.blocker.match(details.url, details.resourceType, pageUrl);
    if (!verdict) return callback({});
    tab.hooks.blocked();
    callback(verdict.redirectUrl ? { redirectURL: verdict.redirectUrl } : { cancel: true });
  });

  // Global Privacy Control: a legally meaningful "do not sell/share" signal in several jurisdictions.
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    if (details.webContentsId === undefined || !tabs.has(details.webContentsId)) return callback({});
    callback({ requestHeaders: { ...details.requestHeaders, "Sec-GPC": "1" } });
  });

  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (alwaysAllowed.has(permission)) return callback(true);
    const kinds = permissionKinds(permission, "mediaTypes" in details ? (details.mediaTypes ?? []) : []);
    if (!kinds || !tabs.has(contents.id)) return callback(false);
    state.prompts.request(contents.id, details.requestingUrl || contents.getURL(), kinds, callback);
  });
  ses.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    if (alwaysAllowed.has(permission)) return true;
    if (!contents || !tabs.has(contents.id)) return false;
    const kinds = permissionKinds(permission, details.mediaType ? [details.mediaType] : []);
    return kinds !== null && state.prompts.check(requestingOrigin, kinds);
  });
}

/** Registers a tab page with the privacy layer, for as long as its webContents lives. */
export function attachTabPrivacy(contents: WebContents, hooks: TabPrivacyHooks): void {
  const id = contents.id;
  tabs.set(id, { contents, hooks });
  // WebRTC must not reveal local network addresses to pages.
  contents.setWebRTCIPHandlingPolicy("default_public_interface_only");

  contents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) privacy?.prompts.denyAll(id);
  });
  contents.on("did-navigate", () => privacy?.https.clear(id));
  if (privacy) {
    // Element hiding, driven from main (ADR-006); listens to the tab's events for its lifetime.
    const { blocker, shields } = privacy;
    new TabCosmetics(contents, blocker, (url) => {
      const host = webHostname(url);
      return !!host && shields.isEnabled(host);
    });
  }
  contents.once("destroyed", () => {
    tabs.delete(id);
    privacy?.prompts.denyAll(id);
    privacy?.https.clear(id);
  });
}

/** Whether `contents` is a tab page (registered by `attachTabPrivacy`), as opposed to browser UI. */
export function isTabPage(contents: WebContents): boolean {
  return tabs.get(contents.id)?.contents === contents;
}

/** Whether content blocking applies to this page (always true for non-web pages: nothing to toggle). */
export function shieldsEnabledFor(url: string): boolean {
  const host = webHostname(url);
  return !host || (privacy?.shields.isEnabled(host) ?? true);
}

export function setShieldsEnabled(url: string, enabled: boolean): void {
  const host = webHostname(url);
  if (host) void privacy?.shields.setEnabled(host, enabled);
}

export function onShieldsChange(listener: () => void): () => void {
  return privacy?.shields.onChange(listener) ?? (() => {});
}

/** HTTPS-Only: the http:// URL to offer when a tab's upgraded load failed, else null. */
export function httpsFallbackFor(contentsId: number, failedUrl: string, code: number): string | null {
  return privacy?.https.fallbackFor(contentsId, failedUrl, code) ?? null;
}

/** HTTPS-Only exception for the URL's host, until the browser quits. */
export function allowHttp(url: string): void {
  privacy?.https.allowHttp(url);
}

export function respondPermission(contentsId: number, promptId: string, allow: boolean, remember: boolean): void {
  privacy?.prompts.respond(contentsId, promptId, allow, remember);
}
