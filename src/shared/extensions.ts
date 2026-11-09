/**
 * Browser extensions (ADR-024), desktop only. Pure: the types crossing IPC and the manifest checks
 * main runs before installing anything. Loading itself is Electron's (`session.extensions`).
 */

/** An installed extension, as `browser://extensions` lists it. */
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
    return { ok: false, message: "Le fichier manifest.json de l'extension est illisible." };
  }
  const manifest = raw as Record<string, unknown>;
  const manifestVersion = manifest.manifest_version;
  if (manifestVersion !== 2 && manifestVersion !== 3) {
    return { ok: false, message: "Version de manifeste non prise en charge : seules les extensions Manifest V2 et V3 sont acceptées." };
  }
  const name = typeof manifest.name === "string" ? localizeMessage(manifest.name, messages).trim() : "";
  if (!name || name.startsWith("__MSG_")) return { ok: false, message: "Le manifeste de l'extension ne donne pas de nom." };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, message: "Le nom de l'extension est trop long." };
  const version = typeof manifest.version === "string" ? manifest.version.trim() : "";
  if (!isVersion(version)) {
    return { ok: false, message: "Le manifeste de l'extension n'a pas de version valide (par exemple « 1.2.0 »)." };
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
const ALL_SITES_LABEL = "Lire et modifier toutes vos données sur tous les sites";

/** Chrome's permission warnings, in French; permissions without a warning (storage, alarms…) are absent. */
const PERMISSION_LABELS: Record<string, string> = {
  tabs: "Lire votre historique de navigation",
  history: "Lire et modifier votre historique de navigation",
  topSites: "Lire la liste de vos sites les plus visités",
  bookmarks: "Lire et modifier vos favoris",
  downloads: "Gérer vos téléchargements",
  "downloads.open": "Ouvrir les fichiers téléchargés",
  clipboardRead: "Lire les données copiées dans le presse-papiers",
  clipboardWrite: "Modifier les données copiées dans le presse-papiers",
  notifications: "Afficher des notifications",
  geolocation: "Connaître votre position géographique",
  webRequest: "Observer le trafic des pages",
  webRequestBlocking: "Bloquer ou modifier les requêtes des pages",
  declarativeNetRequest: "Bloquer du contenu sur n'importe quelle page",
  declarativeNetRequestFeedback: "Lire votre historique de navigation",
  management: "Gérer vos applications, extensions et thèmes",
  nativeMessaging: "Communiquer avec des applications installées sur l'ordinateur",
  privacy: "Modifier vos paramètres de confidentialité",
  proxy: ALL_SITES_LABEL,
  pageCapture: ALL_SITES_LABEL,
  debugger: "Accéder au débogueur des pages",
  contentSettings: "Modifier les autorisations des sites (cookies, JavaScript, caméra…)",
  desktopCapture: "Capturer le contenu de votre écran",
  "identity.email": "Connaître votre adresse e-mail",
  ttsEngine: "Lire tout le texte prononcé par synthèse vocale",
  sessions: "Lire votre historique de navigation",
  readingList: "Lire et modifier les entrées de votre liste de lecture",
  favicon: "Lire les icônes des sites que vous visitez",
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
      const others = more > 0 ? ` et ${more} autre${more > 1 ? "s" : ""} site${more > 1 ? "s" : ""}` : "";
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
