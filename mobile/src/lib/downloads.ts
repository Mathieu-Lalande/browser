import { fileExtension, isSafeToOpenName } from "@shared/downloads";

/**
 * Downloads on the phone (ADR-055): files the WebView cannot show (iOS `onFileDownload`, Android
 * download listener through the `web-session` module) or links downloaded from the link menu are
 * fetched by the app into its own documents folder (`Downloads/`) and listed in "Téléchargements".
 * Private tabs: the file goes to the cache, is offered once through the share sheet and is never
 * listed (the private cache folder is emptied when the private session ends and at start-up).
 */

export interface MobileDownload {
  id: string;
  /** File name in the downloads folder (unique there). */
  name: string;
  /** Bytes (0 when unknown). */
  size: number;
  mimeType: string;
  /** Page URL the file came from (http/https). */
  url: string;
  /** Epoch milliseconds. */
  createdAt: number;
}

/** Entries kept in the list; older ones are deleted with their file. */
export const MAX_DOWNLOADS = 200;
const MAX_NAME = 120;

/** What a WebView asked to download, validated (Android payload or iOS event). */
export interface DownloadRequest {
  url: string;
  contentDisposition: string;
  mimeType: string;
  /** Announced length, -1 when unknown. */
  contentLength: number;
}

const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/json": "json",
  "application/epub+zip": "epub",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

/** Only http(s) can be fetched by the app (no data:, blob: or file:). */
export function isDownloadableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** The file name a `Content-Disposition` header gives (RFC 6266 / 5987), or "". */
export function dispositionFileName(header: string): string {
  if (!header) return "";
  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[2]!.trim().replace(/^"|"$/g, ""));
    } catch {
      // Malformed escape: fall back to the plain parameter.
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
  return plain ? (plain[2] ?? plain[1]!).trim() : "";
}

/** A name safe for the app's folder: no path, no control or reserved characters, capped, never hidden. */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  let name = base.replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, "_").replace(/\s+/g, " ").trim().replace(/^\.+/, "").replace(/[.\s]+$/, "");
  if (name.length > MAX_NAME) {
    const extension = fileExtension(name);
    const keep = extension && extension.length < 12 ? `.${extension}` : "";
    name = name.slice(0, MAX_NAME - keep.length) + keep;
  }
  return name;
}

/** Name of a download: Content-Disposition, else the URL's last segment, else "download"; extension from the type when missing. */
export function downloadFileName(url: string, contentDisposition: string, mimeType: string): string {
  let name = sanitizeFileName(dispositionFileName(contentDisposition));
  if (!name) {
    try {
      const segment = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
      name = sanitizeFileName(decodeURIComponent(segment));
    } catch {
      name = "";
    }
  }
  if (!name) name = "download";
  const type = mimeType.split(";")[0]!.trim().toLowerCase();
  const extension = MIME_EXTENSIONS[type];
  if (!fileExtension(name) && extension) name = `${name}.${extension}`;
  return name;
}

/** `name` unless taken: "rapport (1).pdf", "rapport (2).pdf"… */
export function uniqueFileName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const extension = fileExtension(name);
  const stem = extension ? name.slice(0, -(extension.length + 1)) : name;
  for (let index = 1; ; index++) {
    const candidate = `${stem} (${index})${extension ? `.${extension}` : ""}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Validates a download request coming from native code or a WebView event. */
export function parseDownloadRequest(value: unknown): DownloadRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const url = typeof record.url === "string" ? record.url : typeof record.downloadUrl === "string" ? record.downloadUrl : "";
  if (url.length > 8192 || !isDownloadableUrl(url)) return null;
  const text = (key: string, max: number) => (typeof record[key] === "string" ? (record[key] as string).slice(0, max) : "");
  const length = typeof record.contentLength === "number" && Number.isFinite(record.contentLength) ? Math.max(-1, Math.floor(record.contentLength)) : -1;
  return { url, contentDisposition: text("contentDisposition", 1024), mimeType: text("mimeType", 200), contentLength: length };
}

/** "Ouvrir" (preview / default app): only for types whose usual viewers do not run code (same list as the desktop). */
export const canOpenDownload = (item: MobileDownload): boolean => isSafeToOpenName(item.name);

/** Adds a finished download first; returns the list and the entries dropped by the cap (their files must go). */
export function addDownload(list: readonly MobileDownload[], item: MobileDownload, cap = MAX_DOWNLOADS): { list: MobileDownload[]; dropped: MobileDownload[] } {
  const next = [item, ...list.filter((entry) => entry.id !== item.id)];
  return { list: next.slice(0, cap), dropped: next.slice(cap) };
}

/** The stored list, validated (garbage entries are dropped). */
export function parseDownloads(data: unknown): MobileDownload[] {
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const out: MobileDownload[] = [];
  for (const value of data) {
    if (typeof value !== "object" || value === null) continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.id !== "string" || typeof entry.name !== "string" || typeof entry.url !== "string") continue;
    const name = sanitizeFileName(entry.name);
    if (!name || name !== entry.name || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push({
      id: entry.id,
      name,
      size: typeof entry.size === "number" && entry.size > 0 ? Math.floor(entry.size) : 0,
      mimeType: typeof entry.mimeType === "string" ? entry.mimeType.slice(0, 200) : "",
      url: isDownloadableUrl(entry.url) ? entry.url : "",
      createdAt: typeof entry.createdAt === "number" ? entry.createdAt : 0,
    });
  }
  return out.slice(0, MAX_DOWNLOADS);
}
