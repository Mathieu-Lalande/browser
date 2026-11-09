/**
 * Browser extensions (ADR-024), desktop only. Pure: the types crossing IPC and the manifest checks
 * main runs before installing anything. Loading itself is Electron's (`session.extensions`).
 */

/** An installed extension, as `browser://extensions` lists it. */
import { t } from "./i18n";

export interface ExtensionInfo {
  /** Our own Chrome-style id (32 letters a–p), stable across launches. */
  id: string;
  name: string;
  version: string;
  description: string;
  manifestVersion: 2 | 3;
  /** Small `data:` image, or null (the page shows a Lucide icon instead). */
  icon: string | null;
  enabled: boolean;
  /** "Autoriser en navigation privée" (default off). */
  allowPrivate: boolean;
  /** Unpacked into the profile (from a .zip/.crx) rather than a folder the user picked. */
  managed: boolean;
  /** Why the extension could not be loaded at the last attempt (French, for the user). */
  error?: string;
  /** Installed from the Chrome Web Store (ADR-049): its store id, kept up to date from there. */
  webStoreId?: string;
  /** Its toolbar button (ADR-049), null when the manifest declares none. */
  action: ExtensionAction | null;
  /** Shown in the sidebar's extension row (else only in the puzzle menu). */
  pinned: boolean;
  /** Permission warnings (French), as shown before installing. */
  permissions: string[];
}

/** Result of an install: null when the user cancelled the file dialog. */
export type ExtensionInstallResult = { ok: true; extension: ExtensionInfo } | { ok: false; message: string } | null;

export const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

export const isExtensionId = (value: unknown): value is string => typeof value === "string" && EXTENSION_ID_PATTERN.test(value);

/** What the browser keeps from a valid manifest. */
export interface ManifestSummary {
  name: string;
  version: string;
  description: string;
  manifestVersion: 2 | 3;
  /** Path of the best icon inside the extension (≤ 128 px when possible), if any. */
  iconPath: string | null;
}

export type ManifestCheck = { ok: true; manifest: ManifestSummary } | { ok: false; message: string };

const MAX_NAME_LENGTH = 75;
const MAX_DESCRIPTION_LENGTH = 300;
/** Chrome's rule: one to four dot-separated integers, each 0–65535, no leading zero. */
const VERSION_PATTERN = /^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/;

const isVersion = (value: string) => VERSION_PATTERN.test(value) && value.split(".").every((part) => Number(part) <= 65535);

/** Chrome's `__MSG_name__` placeholders, resolved from the default locale's messages (case-insensitive keys). */
export function localizeMessage(value: string, messages: Record<string, unknown> | null): string {
  const match = /^__MSG_([A-Za-z0-9_@]+)__$/.exec(value.trim());
  if (!match) return value;
  const key = match[1].toLowerCase();
  for (const [name, entry] of Object.entries(messages ?? {})) {
    if (name.toLowerCase() !== key || typeof entry !== "object" || entry === null) continue;
    const message = (entry as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return value;
}

/** A relative path inside the extension: no absolute path, no `..`, no backslash tricks. */
export function isSafeRelativePath(path: string): boolean {
  if (!path || path.length > 512 || path.includes("\0") || path.includes("\\")) return false;
  if (path.startsWith("/") || /^[a-z]:/i.test(path)) return false;
  return path.split("/").every((part) => part !== ".." && part !== "");
}

function bestIcon(icons: unknown): string | null {
  if (typeof icons !== "object" || icons === null) return null;
  const sizes = Object.entries(icons)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && isSafeRelativePath(entry[1].replace(/^\.?\//, "")))
    .map(([size, path]) => ({ size: Number(size) || 0, path: path.replace(/^\.?\//, "") }));
  if (!sizes.length) return null;
  const small = sizes.filter((icon) => icon.size <= 128).sort((a, b) => b.size - a.size);
  return (small[0] ?? sizes.sort((a, b) => a.size - b.size)[0]).path;
}

/**
 * Checks a parsed `manifest.json`: manifest version 2 or 3, a name and a valid version. `messages`
 * are the default locale's (for `__MSG_…__` names). Errors are French, shown to the user as is.
 */
export function validateManifest(raw: unknown, messages: Record<string, unknown> | null = null): ManifestCheck {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: t("extensions.extensionsManifestJsonFile") };
  }
  const manifest = raw as Record<string, unknown>;
  const manifestVersion = manifest.manifest_version;
  if (manifestVersion !== 2 && manifestVersion !== 3) {
    return { ok: false, message: t("extensions.unsupportedManifestVersionOnly") };
  }
  const name = typeof manifest.name === "string" ? localizeMessage(manifest.name, messages).trim() : "";
  if (!name || name.startsWith("__MSG_")) return { ok: false, message: t("extensions.extensionsManifestDoesntGive") };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, message: t("extensions.extensionsNameTooLong") };
  const version = typeof manifest.version === "string" ? manifest.version.trim() : "";
  if (!isVersion(version)) {
    return { ok: false, message: t("extensions.extensionsManifestHasNo") };
  }
  const description = typeof manifest.description === "string" ? localizeMessage(manifest.description, messages).trim() : "";
  return {
    ok: true,
    manifest: {
      name,
      version,
      description: description.startsWith("__MSG_") ? "" : description.slice(0, MAX_DESCRIPTION_LENGTH),
      manifestVersion,
      iconPath: bestIcon(manifest.icons),
    },
  };
}

/* ---------------------------------------------------------------------------------------------
 * ADR-049: toolbar buttons, permission review, Chrome Web Store.
 * ------------------------------------------------------------------------------------------- */

/** An extension's toolbar button (`action`, or MV2 `browser_action` / `page_action`), as the sidebar draws it. */
export interface ExtensionAction {
  /** `default_title`, else the extension's name. */
  title: string;
  /** Small `data:` image (the action's icon, else the extension's), or null. */
  icon: string | null;
  /** A `default_popup` page exists: clicking opens it. Without one, the click cannot reach the extension (ADR-049). */
  hasPopup: boolean;
}

/** The action declared by a manifest: paths inside the extension (not read yet). */
export interface ManifestAction {
  title: string | null;
  iconPath: string | null;
  popup: string | null;
}

/** The confirmation shown (overlay "extension-install") before installing or updating from the Web Store. */
export interface ExtensionReview {
  name: string;
  version: string;
  icon: string | null;
  /** All the warnings (install) or only the new ones (update). */
  permissions: string[];
  /** An update of an installed extension asking for more permissions. */
  update: boolean;
  /** Where it comes from: the store (signature checked) or a package dropped on the page. */
  source?: "store" | "file";
}

/** Outcome of "Mettre à jour les extensions" (French message for the page). */
export interface ExtensionUpdateResult {
  ok: boolean;
  message: string;
}

const cleanPath = (path: string) => path.replace(/^\.?\//, "");

/** `action` (MV3), `browser_action` / `page_action` (MV2): the button's title, icon and popup. */
export function manifestAction(raw: unknown, messages: Record<string, unknown> | null = null): ManifestAction | null {
  if (typeof raw !== "object" || raw === null) return null;
  const manifest = raw as Record<string, unknown>;
  const action = [manifest.action, manifest.browser_action, manifest.page_action].find((value) => typeof value === "object" && value !== null) as
    | Record<string, unknown>
    | undefined;
  if (!action) return null;
  const title = typeof action.default_title === "string" ? localizeMessage(action.default_title, messages).trim().slice(0, MAX_NAME_LENGTH) : "";
  const icon = action.default_icon;
  const iconPath = typeof icon === "string" ? (isSafeRelativePath(cleanPath(icon)) ? cleanPath(icon) : null) : bestIcon(icon);
  const popup = typeof action.default_popup === "string" ? cleanPath(action.default_popup.split(/[?#]/)[0]) : "";
  return {
    title: title && !title.startsWith("__MSG_") ? title : null,
    iconPath,
    popup: popup && isSafeRelativePath(popup) ? popup : null,
  };
}

/** Host patterns meaning "every site". */
const ALL_SITES = new Set(["<all_urls>", "*://*/*", "http://*/*", "https://*/*", "*://*/", "http://*/", "https://*/"]);
const MAX_LISTED_HOSTS = 3;
const ALL_SITES_LABEL = t("extensions.readChangeAllData");

/** Chrome's permission warnings, in French; permissions without a warning (storage, alarms…) are absent. */
const PERMISSION_LABELS: Record<string, string> = {
  get tabs() { return t("extensions.readBrowsingHistory") },
  get history() { return t("extensions.readChangeBrowsingHistory") },
  get topSites() { return t("extensions.readListMostVisited") },
  get bookmarks() { return t("extensions.readChangeBookmarks") },
  get downloads() { return t("extensions.manageDownloads") },
  get "downloads.open"() { return t("extensions.openDownloadedFiles") },
  get clipboardRead() { return t("extensions.readDataCopiedClipboard") },
  get clipboardWrite() { return t("extensions.changeDataCopiedClipboard") },
  get notifications() { return t("extensions.showNotifications") },
  get geolocation() { return t("extensions.knowGeographicLocation") },
  get webRequest() { return t("extensions.observePagesTraffic") },
  get webRequestBlocking() { return t("extensions.blockChangePagesRequests") },
  get declarativeNetRequest() { return t("extensions.blockContentAnyPage") },
  get declarativeNetRequestFeedback() { return t("extensions.readBrowsingHistory") },
  get management() { return t("extensions.manageAppsExtensionsThemes") },
  get nativeMessaging() { return t("extensions.communicateAppsInstalledComputer") },
  get privacy() { return t("extensions.changePrivacySettings") },
  proxy: ALL_SITES_LABEL,
  pageCapture: ALL_SITES_LABEL,
  get debugger() { return t("extensions.accessPagesDebugger") },
  get contentSettings() { return t("extensions.changeSitePermissionsCookies") },
  get desktopCapture() { return t("extensions.captureContentScreen") },
  get "identity.email"() { return t("extensions.knowEmailAddress") },
  get ttsEngine() { return t("extensions.readAllTextSpoken") },
  get sessions() { return t("extensions.readBrowsingHistory") },
  get readingList() { return t("extensions.readChangeReadingList") },
  get favicon() { return t("extensions.readIconsSitesYou") },
};

/** The host of a match pattern (`*://*.example.com/*` → `example.com`), or null when it is not a host pattern. */
function patternHost(pattern: string): string | null {
  const match = /^(\*|https?|wss?|ftp):\/\/([^/]*)\//.exec(pattern);
  if (!match) return null;
  const host = match[2].replace(/^\*\./, "").replace(/:\d+$/, "");
  return host && host !== "*" ? host.toLowerCase() : null;
}

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

/**
 * The permission warnings Chrome would show for a manifest, in French: site access first (host
 * permissions, MV2 hosts in `permissions`, content script matches), then the API permissions.
 * Optional permissions are asked by the extension later: not listed.
 */
export function permissionLabels(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null) return [];
  const manifest = raw as Record<string, unknown>;
  const permissions = strings(manifest.permissions);
  const patterns = [...permissions, ...strings(manifest.host_permissions)];
  if (Array.isArray(manifest.content_scripts)) {
    for (const script of manifest.content_scripts) {
      if (typeof script === "object" && script !== null) patterns.push(...strings((script as Record<string, unknown>).matches));
    }
  }
  const labels = new Set<string>();
  if (patterns.some((pattern) => ALL_SITES.has(pattern))) labels.add(ALL_SITES_LABEL);
  else {
    const hosts = [...new Set(patterns.map(patternHost).filter((host): host is string => !!host))].sort();
    const more = hosts.length - MAX_LISTED_HOSTS;
    if (hosts.length) {
      const others = more > 0 ? t("extensions.otherSites", { more }) : "";
      labels.add(`Lire et modifier vos données sur ${hosts.slice(0, MAX_LISTED_HOSTS).join(", ")}${others}`);
    }
  }
  for (const permission of permissions) {
    const label = PERMISSION_LABELS[permission];
    if (label) labels.add(label);
  }
  // "Every site" covers the narrower site access a proxy or page capture would add.
  if (labels.has(ALL_SITES_LABEL)) for (const label of labels) if (label.startsWith("Lire et modifier vos données sur ")) labels.delete(label);
  return [...labels];
}

/**
 * The sites an extension can reach (ADR-049, "Détails"): every host it names (host permissions,
 * MV2 hosts in `permissions`, content script matches), "Tous les sites" for a catch-all pattern.
 */
export function manifestHosts(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null) return [];
  const manifest = raw as Record<string, unknown>;
  const patterns = [...strings(manifest.permissions), ...strings(manifest.host_permissions)];
  if (Array.isArray(manifest.content_scripts)) {
    for (const script of manifest.content_scripts) {
      if (typeof script === "object" && script !== null) patterns.push(...strings((script as Record<string, unknown>).matches));
    }
  }
  if (patterns.some((pattern) => ALL_SITES.has(pattern))) return [t("extensions.allSites")];
  return [...new Set(patterns.map(patternHost).filter((host): host is string => !!host))].sort();
}

/** The API permissions a manifest names (`storage`, `tabs`…), host patterns left out. */
export function manifestApiPermissions(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null) return [];
  return strings((raw as Record<string, unknown>).permissions).filter((permission) => !permission.includes("/") && !ALL_SITES.has(permission));
}

/** The extension's options page (`options_ui.page`, else `options_page`), a safe relative path, or null. */
export function manifestOptionsPage(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const manifest = raw as Record<string, unknown>;
  const ui = manifest.options_ui;
  const embedded = typeof ui === "object" && ui !== null ? (ui as Record<string, unknown>).page : undefined;
  const page = typeof embedded === "string" ? embedded : manifest.options_page;
  if (typeof page !== "string") return null;
  const path = cleanPath(page.split(/[?#]/)[0]);
  return path && isSafeRelativePath(path) ? path : null;
}

/** What "Détails" shows on `browser://extensions` (read from the folder when asked). */
export interface ExtensionDetailsInfo {
  id: string;
  /** Sites it can read and change ("Tous les sites" for every one). */
  hosts: string[];
  /** Its API permissions as the manifest names them (`storage`, `tabs`…). */
  apiPermissions: string[];
  /** Size of its folder on disk, bytes. */
  size: number;
  /** It declares an options page ("Ouvrir les options"). */
  hasOptions: boolean;
  /** Store extensions: the last time new versions were looked for (epoch ms), or null. */
  lastUpdateCheck: number | null;
  /** Its folder, for an unpacked extension the user picked (null when the browser unpacked it). */
  folder: string | null;
}

/** A size in French units ("1,2 Mo"). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

/** A package dropped on `browser://extensions`: a .crx/.zip file's bytes, or a folder's files (copied into the profile). */
export type DroppedExtension = { kind: "file"; name: string; data: Uint8Array } | { kind: "folder"; files: { path: string; data: Uint8Array }[] };

/** Limits of a dropped package (the same as a picked file: 100 Mo). */
export const MAX_DROPPED_SIZE = 100 * 1024 * 1024;
export const MAX_DROPPED_FILES = 50_000;
