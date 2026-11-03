import { fold } from "../fuzzy";

/**
 * Notes and highlights (ADR-037): pure model shared by the desktop (main, UI) and the phone.
 * A highlight is a quote of a page (W3C TextQuoteSelector style: exact text plus some context
 * before and after, and the position where it was made as a hint), a color and an optional note;
 * a page note is free text attached to a page. Pages are keyed by their URL without fragment.
 * Everything coming from storage, IPC or sync goes through the sanitizers below.
 */

export const ANNOTATIONS_VERSION = 1;

export const ANNOTATION_LIMITS = {
  /** Highlighted text, in characters (longer selections are refused, not cut). */
  exact: 4000,
  /** Context kept on each side of the quote. */
  context: 64,
  note: 5000,
  pageNote: 20_000,
  title: 300,
  url: 2048,
  highlights: 10_000,
  notes: 2000,
} as const;

/** The four colors; each platform draws them light or dark (`HIGHLIGHT_SWATCHES`). */
export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];
export const isHighlightColor = (value: unknown): value is HighlightColor => HIGHLIGHT_COLORS.includes(value as HighlightColor);

export const COLOR_LABELS: Record<HighlightColor, string> = { yellow: "Jaune", green: "Vert", blue: "Bleu", pink: "Rose" };

/**
 * Highlight backgrounds: translucent on a light page, deeper on a dark one (text stays readable:
 * the page's own text color is kept). `ink` is the UI's swatch.
 */
export const HIGHLIGHT_SWATCHES: Record<HighlightColor, { light: string; dark: string; ink: string }> = {
  yellow: { light: "rgb(255 214 10 / 0.42)", dark: "rgb(214 170 0 / 0.45)", ink: "#f5c400" },
  green: { light: "rgb(52 199 89 / 0.32)", dark: "rgb(38 160 72 / 0.45)", ink: "#34c759" },
  blue: { light: "rgb(64 156 255 / 0.32)", dark: "rgb(40 120 230 / 0.5)", ink: "#409cff" },
  pink: { light: "rgb(255 92 168 / 0.32)", dark: "rgb(220 60 140 / 0.5)", ink: "#ff5ca8" },
};

/** Where the quote is: its text, some context, and its offset in the page's text (a hint). */
export interface TextQuote {
  exact: string;
  prefix: string;
  suffix: string;
  /** Offset of `exact` in the page's normalized text when it was made. */
  start: number;
}

export interface Highlight extends TextQuote {
  id: string;
  /** Page URL without fragment (`annotationUrl`). */
  url: string;
  /** Page title when the highlight was made. */
  title: string;
  color: HighlightColor;
  /** Empty: no note. */
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface PageNote {
  url: string;
  title: string;
  text: string;
  updatedAt: number;
}

export interface AnnotationsData {
  highlights: Highlight[];
  notes: PageNote[];
}

export const emptyAnnotations = (): AnnotationsData => ({ highlights: [], notes: [] });

/** What the page side needs to draw a highlight (no note text, no page metadata). */
export interface HighlightMark extends TextQuote {
  id: string;
  color: HighlightColor;
  hasNote: boolean;
}

export const markOf = (highlight: Highlight): HighlightMark => ({
  id: highlight.id,
  exact: highlight.exact,
  prefix: highlight.prefix,
  suffix: highlight.suffix,
  start: highlight.start,
  color: highlight.color,
  hasNote: highlight.note !== "",
});

// --- Validation ---------------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const time = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null);
/** Control characters out (tabs and line breaks kept), bounded. */
const cleanText = (value: unknown, max: number): string | null =>
  typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, max) : null;

export const isAnnotationId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value);

/**
 * The key of a page: http(s) only, without fragment nor credentials. Null for anything else
 * (internal pages, files, data:…): those are never annotated.
 */
export function annotationUrl(url: unknown): string | null {
  if (typeof url !== "string" || url.length > ANNOTATION_LIMITS.url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    parsed.hash = "";
    parsed.username = "";
    parsed.password = "";
    return parsed.href;
  } catch {
    return null;
  }
}

/** The site a page is grouped under: its host without "www.". */
export function annotationSite(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Validates a quote (pages and IPC send them): whitespace collapsed, bounded, never empty. */
export function sanitizeQuote(value: unknown): TextQuote | null {
  if (!isRecord(value)) return null;
  const exact = cleanText(value.exact, ANNOTATION_LIMITS.exact + 1)?.replace(/\s+/g, " ").trim();
  if (!exact || exact.length > ANNOTATION_LIMITS.exact) return null;
  const context = (text: unknown, end: boolean) => {
    const flat = (cleanText(text, 4 * ANNOTATION_LIMITS.context) ?? "").replace(/\s+/g, " ");
    return end ? flat.slice(-ANNOTATION_LIMITS.context) : flat.slice(0, ANNOTATION_LIMITS.context);
  };
  const start = typeof value.start === "number" && Number.isInteger(value.start) && value.start >= 0 ? value.start : 0;
  return { exact, prefix: context(value.prefix, true), suffix: context(value.suffix, false), start };
}

export function sanitizeHighlight(value: unknown): Highlight | null {
  if (!isRecord(value) || !isAnnotationId(value.id)) return null;
  const quote = sanitizeQuote(value);
  const url = annotationUrl(value.url);
  const createdAt = time(value.createdAt);
  if (!quote || !url || createdAt === null) return null;
  return {
    id: value.id,
    url,
    title: cleanText(value.title, ANNOTATION_LIMITS.title) ?? "",
    ...quote,
    color: isHighlightColor(value.color) ? value.color : "yellow",
    note: cleanText(value.note, ANNOTATION_LIMITS.note) ?? "",
    createdAt,
    updatedAt: time(value.updatedAt) ?? createdAt,
  };
}

export function sanitizePageNote(value: unknown): PageNote | null {
  if (!isRecord(value)) return null;
  const url = annotationUrl(value.url);
  const text = cleanText(value.text, ANNOTATION_LIMITS.pageNote);
  const updatedAt = time(value.updatedAt);
  if (!url || !text?.trim() || updatedAt === null) return null;
  return { url, title: cleanText(value.title, ANNOTATION_LIMITS.title) ?? "", text, updatedAt };
}

/** Stored or received data: invalid entries dropped, one highlight per id, one note per page. */
export function sanitizeAnnotations(value: unknown): AnnotationsData {
  const data = emptyAnnotations();
  if (!isRecord(value)) return data;
  const ids = new Set<string>();
  for (const item of Array.isArray(value.highlights) ? value.highlights : []) {
    const highlight = sanitizeHighlight(item);
    if (!highlight || ids.has(highlight.id) || data.highlights.length >= ANNOTATION_LIMITS.highlights) continue;
    ids.add(highlight.id);
    data.highlights.push(highlight);
  }
  const urls = new Set<string>();
  for (const item of Array.isArray(value.notes) ? value.notes : []) {
    const note = sanitizePageNote(item);
    if (!note || urls.has(note.url) || data.notes.length >= ANNOTATION_LIMITS.notes) continue;
    urls.add(note.url);
    data.notes.push(note);
  }
  return data;
}

/** What the popover and the panels may change on a highlight. */
export interface HighlightPatch {
  color?: HighlightColor;
  note?: string;
}

export function sanitizeHighlightPatch(value: unknown): HighlightPatch | null {
  if (!isRecord(value)) return null;
  const patch: HighlightPatch = {};
  if (value.color !== undefined) {
    if (!isHighlightColor(value.color)) return null;
    patch.color = value.color;
  }
  if (value.note !== undefined) {
    const note = cleanText(value.note, ANNOTATION_LIMITS.note + 1);
    if (note === null || note.length > ANNOTATION_LIMITS.note) return null;
    patch.note = note.trim() ? note : "";
  }
  return patch;
}

// --- Operations (immutable) ---------------------------------------------------------------------

export interface NewHighlight {
  id: string;
  url: string;
  title: string;
  quote: TextQuote;
  color: HighlightColor;
  now: number;
}

/** Adds a highlight (null when invalid or the collection is full). */
export function addHighlight(data: AnnotationsData, input: NewHighlight): AnnotationsData | null {
  if (data.highlights.length >= ANNOTATION_LIMITS.highlights) return null;
  const highlight = sanitizeHighlight({ ...input.quote, id: input.id, url: input.url, title: input.title, color: input.color, note: "", createdAt: input.now, updatedAt: input.now });
  return highlight ? { ...data, highlights: [...data.highlights, highlight] } : null;
}

export function updateHighlight(data: AnnotationsData, id: string, patch: HighlightPatch, now: number): AnnotationsData {
  return {
    ...data,
    highlights: data.highlights.map((highlight) => (highlight.id === id ? { ...highlight, ...patch, updatedAt: now } : highlight)),
  };
}

export const removeHighlight = (data: AnnotationsData, id: string): AnnotationsData => ({
  ...data,
  highlights: data.highlights.filter((highlight) => highlight.id !== id),
});

/** Sets a page's note (empty text removes it). */
export function setPageNote(data: AnnotationsData, url: string, title: string, text: string, now: number): AnnotationsData {
  const key = annotationUrl(url);
  if (!key) return data;
  const others = data.notes.filter((note) => note.url !== key);
  const note = sanitizePageNote({ url: key, title, text, updatedAt: now });
  if (!note) return { ...data, notes: others };
  if (others.length >= ANNOTATION_LIMITS.notes) return data;
  return { ...data, notes: [...others, note] };
}

/** Everything about a page: its highlights and its note. */
export function removePage(data: AnnotationsData, url: string): AnnotationsData {
  return { highlights: data.highlights.filter((item) => item.url !== url), notes: data.notes.filter((note) => note.url !== url) };
}

export const highlightsFor = (data: AnnotationsData, url: string): Highlight[] =>
  data.highlights.filter((highlight) => highlight.url === url).sort((a, b) => a.start - b.start || a.createdAt - b.createdAt);

export const noteFor = (data: AnnotationsData, url: string): PageNote | null => data.notes.find((note) => note.url === url) ?? null;

// --- What the UIs get ----------------------------------------------------------------------------

export type AnnotationResult = { ok: true; id: string } | { ok: false; message: string };

/** The notes panel: the page of a tab, its highlights (in page order) and its note. */
export interface TabAnnotations {
  url: string;
  title: string;
  highlights: Highlight[];
  note: string;
  /** Highlights not found on the page as it is now. */
  missing: string[];
  /** A private window: kept in memory for the window only. */
  isPrivate: boolean;
  notice: string | null;
}

/** `browser://notes`: everything in the window's book. */
export interface AnnotationsList extends AnnotationsData {
  isPrivate: boolean;
  notice: string | null;
}

// --- Lists ---------------------------------------------------------------------------------------

export interface AnnotatedPage {
  url: string;
  title: string;
  highlights: Highlight[];
  note: PageNote | null;
  /** Latest change, for ordering. */
  updatedAt: number;
}

export interface AnnotatedSite {
  site: string;
  pages: AnnotatedPage[];
  updatedAt: number;
}

export interface AnnotationFilter {
  query?: string;
  /** Only highlights of these colors (empty or missing: all); page notes are kept when they match. */
  colors?: readonly HighlightColor[];
}

/** Pages with their highlights and note, filtered, most recently changed first. */
export function annotatedPages(data: AnnotationsData, filter: AnnotationFilter = {}): AnnotatedPage[] {
  const terms = fold(filter.query ?? "").split(/\s+/).filter(Boolean);
  const colors = filter.colors?.length ? new Set(filter.colors) : null;
  const matches = (...texts: string[]) => {
    const haystack = fold(texts.join(" "));
    return terms.every((term) => haystack.includes(term));
  };
  const pages = new Map<string, AnnotatedPage>();
  const page = (url: string, title: string) => {
    let entry = pages.get(url);
    if (!entry) pages.set(url, (entry = { url, title, highlights: [], note: null, updatedAt: 0 }));
    if (!entry.title && title) entry.title = title;
    return entry;
  };
  for (const note of data.notes) {
    const pageMatches = matches(note.title, note.url);
    if (colors || !(pageMatches || matches(note.text))) continue;
    const entry = page(note.url, note.title);
    entry.note = note;
    entry.updatedAt = Math.max(entry.updatedAt, note.updatedAt);
  }
  for (const highlight of data.highlights) {
    if (colors && !colors.has(highlight.color)) continue;
    if (!matches(highlight.exact, highlight.note, highlight.title, highlight.url)) continue;
    const entry = page(highlight.url, highlight.title);
    entry.highlights.push(highlight);
    entry.updatedAt = Math.max(entry.updatedAt, highlight.updatedAt);
  }
  for (const entry of pages.values()) entry.highlights.sort((a, b) => a.start - b.start || a.createdAt - b.createdAt);
  return [...pages.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** `annotatedPages` grouped by site, most recent site first. */
export function annotatedSites(data: AnnotationsData, filter: AnnotationFilter = {}): AnnotatedSite[] {
  const sites = new Map<string, AnnotatedSite>();
  for (const page of annotatedPages(data, filter)) {
    const site = annotationSite(page.url);
    let entry = sites.get(site);
    if (!entry) sites.set(site, (entry = { site, pages: [], updatedAt: page.updatedAt }));
    entry.pages.push(page);
  }
  return [...sites.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Counts for headers and badges. */
export const annotationCount = (data: AnnotationsData) => data.highlights.length + data.notes.length;
