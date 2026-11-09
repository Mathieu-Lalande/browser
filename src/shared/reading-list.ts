import { countWords, readingMinutes, type ReaderArticle, type ReaderNode } from "./reader";
import { isNavigableUrl } from "./url";

/**
 * Reading list, "Lire plus tard" (ADR-047). Pure model shared by the desktop and the phone: items
 * keyed by a hash of their URL (the same page added on two devices is one item), read/unread, and
 * an offline copy of the page's reader-mode text (ADR-026's extraction, as plain paragraphs: never
 * HTML). The list is synced end to end (`reading` collection) with the text, capped.
 */

export const READING_VERSION = 1;
export const MAX_READING_ITEMS = 500;
/** Characters of offline text kept per item (and synced: a record stays well under the relay's limit). */
export const MAX_READING_TEXT = 40_000;
/** Characters of offline text kept for the whole list: older read items lose theirs first. */
export const MAX_READING_TOTAL_TEXT = 4_000_000;
const MAX_TITLE = 300;
const MAX_SITE = 100;
const MAX_EXCERPT = 280;
const MAX_URL = 4096;

export interface ReadingItem {
  /** `readingId(url)`: stable across devices. */
  id: string;
  url: string;
  title: string;
  siteName: string;
  /** The first lines of the text, for the list. */
  excerpt: string;
  /** Offline copy of the reader-mode text: paragraphs separated by blank lines (empty: none). */
  text: string;
  /** Estimated reading time, in minutes (null without text). */
  minutes: number | null;
  addedAt: number;
  /** When it was marked read (null: unread). */
  readAt: number | null;
}

/** The list as the UIs show it: without the texts (fetched one at a time). */
export type ReadingEntry = Omit<ReadingItem, "text"> & { offline: boolean };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
// eslint-disable-next-line no-control-regex
const line = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const time = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null);

export const isReadingUrl = (value: unknown): value is string => typeof value === "string" && value.length <= MAX_URL && /^https?:\/\//i.test(value) && isNavigableUrl(value);

/** Fragment-safe id of a page (`browser://reading-list#<id>`): a 53-bit hash of the URL without its fragment. */
export function readingId(url: string): string {
  const text = url.split("#")[0];
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `r${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

export const isReadingId = (value: unknown): value is string => typeof value === "string" && /^r[a-z0-9]{1,14}$/.test(value);

/** Paragraphs as stored: control characters dropped, blank-line separated, capped. */
export function cleanReadingText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_READING_TEXT);
}

const BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "figcaption", "dt", "dd", "td", "th", "tr"]);
const flat = (nodes: readonly ReaderNode[]): string =>
  nodes.map((node) => (typeof node === "string" ? node : node.tag === "br" ? "\n" : node.tag === "img" ? "" : flat(node.children))).join("");
const hasBlock = (nodes: readonly ReaderNode[]): boolean => nodes.some((node) => typeof node !== "string" && (BLOCKS.has(node.tag) || hasBlock(node.children)));

/** The article's text as paragraphs (headings, list items, quotes… each one), images left out. */
export function articleParagraphs(nodes: readonly ReaderNode[]): string[] {
  const out: string[] = [];
  let loose = "";
  const flush = () => {
    if (loose.trim()) out.push(loose.trim());
    loose = "";
  };
  for (const node of nodes) {
    if (typeof node === "string") loose += node;
    else if (BLOCKS.has(node.tag) && !hasBlock(node.children)) {
      flush();
      const text = flat(node.children).replace(/[ \t]+/g, " ").trim();
      if (text) out.push(text);
    } else if (hasBlock(node.children)) {
      flush();
      out.push(...articleParagraphs(node.children));
    } else loose += flat(node.children);
  }
  flush();
  return out.map((paragraph) => paragraph.replace(/\s*\n\s*/g, "\n").replace(/[ \t]+/g, " "));
}

/** A new item for a page, with the offline text of its article when there is one. */
export function createReadingItem(input: { url: string; title: string }, article: ReaderArticle | null, now: number): ReadingItem | null {
  if (!isReadingUrl(input.url)) return null;
  const text = article ? cleanReadingText(articleParagraphs(article.content).join("\n\n")) : "";
  return {
    id: readingId(input.url),
    url: input.url,
    title: line(article?.title || input.title, MAX_TITLE) || input.url.slice(0, MAX_TITLE),
    siteName: line(article?.siteName ?? hostOf(input.url), MAX_SITE),
    excerpt: excerptOf(text),
    text,
    minutes: text ? readingMinutes(countWords(text)) : null,
    addedAt: now,
    readAt: null,
  };
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

const excerptOf = (text: string) => {
  const first = text.replace(/\s+/g, " ").trim();
  return first.length > MAX_EXCERPT ? `${first.slice(0, MAX_EXCERPT - 1)}…` : first;
};

export function sanitizeReadingItem(value: unknown): ReadingItem | null {
  if (!isRecord(value) || !isReadingUrl(value.url)) return null;
  const id = readingId(value.url);
  if (value.id !== undefined && value.id !== id) return null;
  const text = cleanReadingText(value.text);
  const addedAt = time(value.addedAt) ?? 0;
  return {
    id,
    url: value.url,
    title: line(value.title, MAX_TITLE) || value.url.slice(0, MAX_TITLE),
    siteName: line(value.siteName, MAX_SITE),
    excerpt: line(value.excerpt, MAX_EXCERPT) || excerptOf(text),
    text,
    minutes: text ? readingMinutes(countWords(text)) : null,
    addedAt,
    readAt: time(value.readAt),
  };
}

/** A stored list: valid items, one per page, newest first, capped (text budget applied). */
export function sanitizeReadingList(value: unknown): ReadingItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: ReadingItem[] = [];
  for (const raw of value) {
    const item = sanitizeReadingItem(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return capReadingList(sortReading(items));
}

const sortReading = (items: ReadingItem[]) => items.sort((a, b) => b.addedAt - a.addedAt);

/**
 * At most `MAX_READING_ITEMS` (the oldest read ones go first, then the oldest), and at most
 * `MAX_READING_TOTAL_TEXT` characters of offline text (read items lose theirs first, oldest first).
 */
export function capReadingList(items: readonly ReadingItem[]): ReadingItem[] {
  let list = [...items];
  while (list.length > MAX_READING_ITEMS) {
    const victim = [...list].reverse().find((item) => item.readAt !== null) ?? list[list.length - 1];
    list = list.filter((item) => item !== victim);
  }
  let total = list.reduce((sum, item) => sum + item.text.length, 0);
  if (total <= MAX_READING_TOTAL_TEXT) return list;
  const order = [...list].sort((a, b) => Number(b.readAt !== null) - Number(a.readAt !== null) || a.addedAt - b.addedAt);
  const dropped = new Set<string>();
  for (const item of order) {
    if (total <= MAX_READING_TOTAL_TEXT) break;
    if (!item.text) continue;
    total -= item.text.length;
    dropped.add(item.id);
  }
  return list.map((item) => (dropped.has(item.id) ? { ...item, text: "", minutes: null } : item));
}

/**
 * Adds (or re-adds) a page: an item already listed comes back to the top, unread, keeping its
 * text when the new one has none.
 */
export function addReadingItem(list: readonly ReadingItem[], item: ReadingItem): ReadingItem[] {
  const existing = list.find((entry) => entry.id === item.id);
  const merged = existing && !item.text ? { ...item, text: existing.text, minutes: existing.minutes, excerpt: existing.excerpt } : item;
  return capReadingList([merged, ...list.filter((entry) => entry.id !== item.id)]);
}

export function setReadingRead(list: readonly ReadingItem[], id: string, read: boolean, now: number): ReadingItem[] {
  return list.map((item) => (item.id === id ? { ...item, readAt: read ? (item.readAt ?? now) : null } : item));
}

export function removeReadingItem(list: readonly ReadingItem[], id: string): ReadingItem[] {
  return list.filter((item) => item.id !== id);
}

/** The list without the texts, for the UIs. */
export function readingEntries(list: readonly ReadingItem[]): ReadingEntry[] {
  return list.map(({ text, ...rest }) => ({ ...rest, offline: text !== "" }));
}

/** The offline copy drawn as a reader article (ADR-026): one paragraph per block of text. */
export function readingArticle(item: ReadingItem): ReaderArticle {
  const content: ReaderNode[] = item.text.split("\n\n").map((paragraph) => {
    const parts = paragraph.split("\n");
    const children: ReaderNode[] = parts.flatMap((part, index) => (index ? [{ tag: "br" as const, children: [] }, part] : [part]));
    return { tag: "p" as const, children };
  });
  const words = countWords(item.text);
  return { url: item.url, title: item.title, byline: null, siteName: item.siteName || null, lang: null, dir: null, content, words, minutes: readingMinutes(words) };
}

// --- Sync (`reading` collection, on with sync) -------------------------------------------------

/** Every field but the id travels (the local id is the item id). */
export type SyncedReading = Omit<ReadingItem, "id" | "minutes">;

export function readingRecord(item: ReadingItem): SyncedReading {
  const { id: _id, minutes: _minutes, ...rest } = item;
  return rest;
}

export function sanitizeSyncedReading(value: unknown, localId: string): SyncedReading | null {
  const item = sanitizeReadingItem(value);
  return item && item.id === localId ? readingRecord(item) : null;
}

/**
 * Applies synced items (the engine already picked the winners per record): deletes, then upserts.
 * A received item without text keeps this device's copy of it.
 */
export function mergeReadingList(local: readonly ReadingItem[], upserts: readonly { id: string; data: SyncedReading }[], deletes: readonly string[]): ReadingItem[] {
  const byId = new Map(local.filter((item) => !deletes.includes(item.id)).map((item) => [item.id, item]));
  for (const { id, data } of upserts) {
    const item = sanitizeReadingItem({ ...data, id });
    if (!item) continue;
    const existing = byId.get(id);
    byId.set(id, existing && !item.text && existing.text ? { ...item, text: existing.text, minutes: existing.minutes } : item);
  }
  return capReadingList(sortReading([...byId.values()]));
}
