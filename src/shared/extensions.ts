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
