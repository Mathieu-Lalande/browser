import { READABILITY_SOURCE, READERABLE_SOURCE } from "./readability-source";
import type { ReaderTheme } from "./settings";
import { isPageOpenableUrl } from "./url";

/**
 * Reader mode (ADR-026), shared by the desktop and the phone. Readability runs inside the page
 * (desktop: an isolated world; phone: `injectJavaScript`) and returns a plain JSON tree of the
 * article. That tree is untrusted page data: `sanitizeReaderArticle` keeps an allow-list of tags,
 * http(s) links and image sources only, bounded sizes, and nothing else (no attributes, styles,
 * classes or event handlers). The UIs render the tree with their own elements (Svelte
 * `<svelte:element>` on a fixed tag list, React Native `Text`): no HTML string is ever parsed or
 * injected, so there is no HTML sanitizer to get wrong.
 */

/** Tags the reader keeps. Others are unwrapped (their content kept) or dropped (`DROPPED_TAGS`). */
export const READER_TAGS = [
  "p", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code", "em", "strong", "u", "s", "sub", "sup", "mark",
  "small", "br", "hr", "ul", "ol", "li", "a", "img", "figure", "figcaption", "table", "thead", "tbody", "tr", "th",
  "td", "caption", "dl", "dt", "dd", "div",
] as const;
export type ReaderTag = (typeof READER_TAGS)[number];

/** Other tags mapped to an allowed one. */
const RENAMED: Record<string, ReaderTag> = {
  h1: "h2",
  b: "strong",
  i: "em",
  cite: "em",
  q: "em",
  del: "s",
  strike: "s",
  ins: "u",
  kbd: "code",
  samp: "code",
  var: "code",
  tt: "code",
  tfoot: "tbody",
  section: "div",
  article: "div",
  header: "div",
  footer: "div",
  main: "div",
  aside: "div",
  details: "div",
  summary: "p",
};

/** Dropped with their content (also skipped by the page script, to keep the payload small). */
const DROPPED_TAGS = [
  "script", "style", "noscript", "template", "iframe", "frame", "object", "embed", "svg", "math", "form", "input",
  "button", "select", "textarea", "canvas", "video", "audio", "source", "track", "link", "meta", "base", "head",
  "title", "dialog", "slot", "portal",
];

/** Elements kept even without content. */
const VOID_TAGS = new Set<ReaderTag>(["br", "hr", "img", "td", "th"]);
const ALLOWED = new Set<string>(READER_TAGS);

export const READER_LIMITS = {
  /** Elements and text nodes of an article. */
  nodes: 20_000,
  depth: 32,
  /** Characters of text, in all. */
  text: 400_000,
  images: 40,
  url: 2048,
  title: 300,
  byline: 200,
  siteName: 100,
} as const;

export type ReaderNode = string | ReaderElement;

export interface ReaderElement {
  tag: ReaderTag;
  children: ReaderNode[];
  /** `a` only: an http(s) URL. */
  href?: string;
  /** `img` only: http(s) as extracted; on the desktop main swaps it for a `data:` image (ADR-018). */
  src?: string;
  alt?: string;
}

export interface ReaderArticle {
  /** The page the article was taken from (set by the app, never by the page). */
  url: string;
  title: string;
  byline: string | null;
  siteName: string | null;
  lang: string | null;
  dir: "ltr" | "rtl" | null;
  content: ReaderNode[];
  words: number;
  /** Estimated reading time, in minutes (at least 1). */
  minutes: number;
}

/** Average silent reading speed used for the estimate, in words per minute. */
export const READING_WPM = 230;

export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / READING_WPM));
}

export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** One line of plain text (no control characters), or null. */
function line(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\p{Cc}\p{Cf}]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return text || null;
}

/** An absolute http(s) URL (as the page script resolved it), else null. */
function webUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > READER_LIMITS.url) return null;
  if (!/^https?:/i.test(value) || !isPageOpenableUrl(value)) return null;
  return new URL(value).href;
}

interface Budget {
  nodes: number;
  text: number;
  images: number;
  words: number;
}

function sanitizeNodes(input: unknown, depth: number, inPre: boolean, budget: Budget): ReaderNode[] {
  if (!Array.isArray(input)) return [];
  const out: ReaderNode[] = [];
  const pushText = (raw: string): void => {
    let text = raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
    if (!inPre) text = text.replace(/\s+/g, " ");
    if (!text || budget.text <= 0) return;
    text = text.slice(0, budget.text);
    budget.text -= text.length;
    budget.words += countWords(text);
    append(text);
  };
  /** Adds already counted text, merged with a text node before it. */
  const append = (text: string) => {
    const last = out[out.length - 1];
    if (typeof last === "string") out[out.length - 1] = last + text;
    else out.push(text);
  };
  for (const item of input) {
    if (budget.nodes-- <= 0) break;
    if (typeof item === "string") {
      pushText(item);
      continue;
    }
    if (!isRecord(item) || typeof item.tag !== "string") continue;
    const raw = item.tag.toLowerCase();
    if (DROPPED_TAGS.includes(raw)) continue;
    const tag = ALLOWED.has(raw) ? (raw as ReaderTag) : RENAMED[raw];
    // Too deep: the text is kept, the structure flattened.
    const children = sanitizeNodes(item.children, depth + 1, inPre || tag === "pre", budget);
    const unwrap = () => {
      for (const child of children) {
        if (typeof child === "string") append(child);
        else out.push(child);
      }
    };
    if (!tag || depth >= READER_LIMITS.depth) {
      unwrap();
      continue;
    }
    const element: ReaderElement = { tag, children: VOID_TAGS.has(tag) && tag !== "td" && tag !== "th" ? [] : children };
    if (tag === "a") {
      const href = webUrl(item.href);
      if (!href) {
        unwrap();
        continue;
      }
      element.href = href;
    }
    if (tag === "img") {
      const src = webUrl(item.src);
      if (!src || budget.images <= 0) {
        const alt = line(item.alt, 300);
        if (alt) pushText(` ${alt} `);
        continue;
      }
      budget.images--;
      element.src = src;
      element.alt = line(item.alt, 300) ?? "";
    }
    if (!VOID_TAGS.has(tag) && !element.children.some((child) => typeof child !== "string" || child.trim())) continue;
    out.push(element);
  }
  return out;
}

/**
 * Validates what the page script returned (untrusted: on the phone any page can post the same
 * message) into an article for `url`, or null when there is nothing worth reading.
 */
export function sanitizeReaderArticle(value: unknown, url: string): ReaderArticle | null {
  if (!isRecord(value) || !isPageOpenableUrl(url)) return null;
  const budget: Budget = { nodes: READER_LIMITS.nodes, text: READER_LIMITS.text, images: READER_LIMITS.images, words: 0 };
  const content = sanitizeNodes(value.content, 0, false, budget);
  if (!content.length || budget.words === 0) return null;
  const lang = typeof value.lang === "string" && /^[a-z]{2,3}(-[a-z0-9]{1,8}){0,3}$/i.test(value.lang) ? value.lang : null;
  return {
    url,
    title: line(value.title, READER_LIMITS.title) ?? "",
    byline: line(value.byline, READER_LIMITS.byline),
    siteName: line(value.siteName, READER_LIMITS.siteName),
    lang,
    dir: value.dir === "rtl" || value.dir === "ltr" ? value.dir : null,
    content,
    words: budget.words,
    minutes: readingMinutes(budget.words),
  };
}

/** Image sources of an article, in document order (desktop: main fetches them as `data:`). */
export function readerImageSources(nodes: readonly ReaderNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (typeof node === "string") continue;
    if (node.tag === "img" && node.src) out.push(node.src);
    readerImageSources(node.children, out);
  }
  return out;
}

/** The tree with each image's `src` replaced by `map(src)`; images mapped to null are dropped. */
export function mapReaderImages(nodes: readonly ReaderNode[], map: (src: string) => string | null): ReaderNode[] {
  const out: ReaderNode[] = [];
  for (const node of nodes) {
    if (typeof node === "string") out.push(node);
    else if (node.tag === "img") {
      const src = node.src ? map(node.src) : null;
      if (src) out.push({ ...node, src });
    } else out.push({ ...node, children: mapReaderImages(node.children, map) });
  }
  return out;
}

/** Plain text of a subtree (accessibility labels, mobile previews). */
export function readerText(nodes: readonly ReaderNode[]): string {
  return nodes.map((node) => (typeof node === "string" ? node : node.tag === "br" ? "\n" : readerText(node.children))).join("");
}

/**
 * Turns the article element into the JSON tree (in the page script). Text and elements only;
 * links and images as absolute URLs (`href`/`src` properties resolve them); nothing else.
 */
const SERIALIZE = `
const DROP = new Set(${JSON.stringify(DROPPED_TAGS)});
let budget = ${READER_LIMITS.nodes};
const walk = (node, depth) => {
  const out = [];
  for (const child of node.childNodes) {
    if (--budget < 0) break;
    if (child.nodeType === 3) { out.push(child.data); continue; }
    if (child.nodeType !== 1) continue;
    const tag = String(child.localName);
    if (DROP.has(tag)) continue;
    const item = { tag, children: depth < ${READER_LIMITS.depth + 8} ? walk(child, depth + 1) : [] };
    if (tag === "a") item.href = String(child.href || "");
    if (tag === "img") { item.src = String(child.currentSrc || child.src || ""); item.alt = String(child.alt || ""); }
    out.push(item);
  }
  return out;
};`;

/** Page script: whether the document looks like an article (address bar icon). Returns a boolean. */
export const READER_CHECK_SCRIPT = `(() => {
${READERABLE_SOURCE}
try { return document.body ? isProbablyReaderable(document) : false; } catch { return false; }
})()`;

/**
 * Page script: the article as `{ title, byline, siteName, lang, dir, content }` (see
 * `sanitizeReaderArticle`), or null. Readability works on a clone of the document: the page is
 * left untouched, and the clone (no browsing context) loads nothing.
 */
export const READER_EXTRACT_SCRIPT = `(() => {
${READABILITY_SOURCE}
${SERIALIZE}
try {
  const article = new Readability(document.cloneNode(true), { serializer: (el) => el }).parse();
  if (!article || !article.content) return null;
  return { title: article.title, byline: article.byline, siteName: article.siteName, lang: article.lang, dir: article.dir, content: walk(article.content, 0) };
} catch { return null; }
})()`;

/** Colors of the reader page, the same on both platforms. */
export interface ReaderColors {
  background: string;
  text: string;
  muted: string;
  link: string;
  rule: string;
}

const READER_COLORS: Record<"light" | "sepia" | "dark", ReaderColors> = {
  light: { background: "#ffffff", text: "#1f2328", muted: "#5f6670", link: "#1a56c4", rule: "#e3e5e8" },
  sepia: { background: "#f4ecd8", text: "#4a3a2a", muted: "#6e5a44", link: "#8a3f12", rule: "#e0d3b6" },
  dark: { background: "#18181b", text: "#e4e4e7", muted: "#a1a1aa", link: "#8fb8ff", rule: "#2e2e33" },
};

/** "auto" follows the app's theme (light or dark). */
export function readerColors(theme: ReaderTheme, appDark: boolean): ReaderColors {
  return READER_COLORS[theme === "auto" ? (appDark ? "dark" : "light") : theme];
}

/** Maximum line length of each width setting, in `ch` (the phone always uses the screen width). */
export const READER_WIDTHS = { narrow: 56, medium: 68, wide: 84 } as const;

export const READER_THEME_LABELS: Record<ReaderTheme, string> = { auto: "Thème", sepia: "Sépia", dark: "Sombre" };

export function readingTimeLabel(minutes: number): string {
  return `${minutes} min de lecture`;
}
