import type { ReaderArticle, ReaderNode } from "./reader";

/**
 * Read aloud for the reader (ADR-058), shared by the desktop (Web Speech API in the chrome UI) and
 * the phone (`expo-speech`). Everything here is pure: the article tree becomes a list of
 * paragraphs, each split into short chunks (speech engines cut or drop long utterances: Chromium
 * stops after about 15 s on some systems, Android refuses more than 4000 characters), plus the
 * navigation between them and the voice choice. Speech stays on the device: only voices the
 * system marks as local are offered.
 */

/** Characters per utterance: one sentence, or a part of a long one. */
export const SPEECH_CHUNK_MAX = 220;
/** Speeds offered (1 = the engine's normal rate). */
export const SPEECH_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export const SPEECH_RATE_LIMITS = { min: 0.75, max: 2 } as const;

/** One spoken block: a paragraph, heading, list item… `key` is its path in the tree ("title" for the title). */
export interface SpeechParagraph {
  key: string;
  text: string;
  chunks: string[];
}

export interface SpeechPosition {
  paragraph: number;
  chunk: number;
}

/** Tags whose content is read as one block (unless they hold other blocks). */
const BLOCK_TAGS = new Set([
  "p", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "ul", "ol", "li", "figure", "figcaption", "table",
  "thead", "tbody", "tr", "th", "td", "caption", "dl", "dt", "dd", "div", "hr",
]);
/** Left out of the spoken text (code reads badly, images have no text). */
const SILENT_TAGS = new Set(["pre", "img", "hr", "br"]);

const isBlock = (node: ReaderNode): boolean => typeof node !== "string" && BLOCK_TAGS.has(node.tag);
const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

function inlineText(nodes: readonly ReaderNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (typeof node === "string") out += node;
    else if (node.tag === "br") out += " ";
    else if (!SILENT_TAGS.has(node.tag)) out += inlineText(node.children);
  }
  return out;
}

/** Sentences of `text`, each at most `max` characters (split at commas, then spaces, then anywhere). */
export function speechChunks(text: string, max = SPEECH_CHUNK_MAX): string[] {
  const clean = normalize(text);
  if (!clean) return [];
  // A sentence ends with . ! ? … (or CJK marks), closing quotes/brackets included (French "Oui. »" too), before a space
  // ("3.14" and "example.com" stay whole).
  const sentences = clean.replace(/([.!?…。！？]+(?:["'”’)\]]|[\s\u00a0\u202f]*»)*)\s+/g, "$1\u0000").split("\u0000");
  const out: string[] = [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (sentence) out.push(...splitLong(sentence, max));
  }
  return out;
}

function splitLong(sentence: string, max: number): string[] {
  if (sentence.length <= max) return [sentence];
  const out: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    let cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf(": "));
    if (cut < max / 3) cut = window.lastIndexOf(" ");
    else cut += 1;
    if (cut < max / 3) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * The article as spoken paragraphs, in reading order: the title first, then every block that holds
 * text. A block holding other blocks is entered; its loose text (if any) is read under its own key.
 */
export function speechParagraphs(article: Pick<ReaderArticle, "title" | "content">, max = SPEECH_CHUNK_MAX): SpeechParagraph[] {
  const out: SpeechParagraph[] = [];
  const push = (key: string, text: string) => {
    const chunks = speechChunks(text, max);
    if (chunks.length) out.push({ key, text: normalize(text), chunks });
  };
  push("title", article.title);
  const visit = (nodes: readonly ReaderNode[], prefix: string, loose: string) => {
    let pending = "";
    nodes.forEach((node, index) => {
      const key = prefix ? `${prefix}.${index}` : String(index);
      if (typeof node !== "string" && SILENT_TAGS.has(node.tag)) return;
      if (!isBlock(node)) {
        pending += typeof node === "string" ? node : inlineText(node.children);
        return;
      }
      push(loose, pending);
      pending = "";
      const element = node as Exclude<ReaderNode, string>;
      if (element.children.some(isBlock)) visit(element.children, key, key);
      else push(key, inlineText(element.children));
    });
    push(loose, pending);
  };
  visit(article.content, "", "content");
  return out;
}

export const START: SpeechPosition = { paragraph: 0, chunk: 0 };

/** The chunk after `position`, or null at the end of the article. */
export function nextChunk(paragraphs: readonly SpeechParagraph[], position: SpeechPosition): SpeechPosition | null {
  const paragraph = paragraphs[position.paragraph];
  if (!paragraph) return null;
  if (position.chunk + 1 < paragraph.chunks.length) return { paragraph: position.paragraph, chunk: position.chunk + 1 };
  return position.paragraph + 1 < paragraphs.length ? { paragraph: position.paragraph + 1, chunk: 0 } : null;
}

/**
 * Previous/next paragraph (`delta` −1/+1). Going back from inside a paragraph restarts it, like a
 * music player's "previous" (twice goes to the one before). Null past the end.
 */
export function stepParagraph(paragraphs: readonly SpeechParagraph[], position: SpeechPosition, delta: -1 | 1): SpeechPosition | null {
  if (delta < 0 && position.chunk > 0) return { paragraph: position.paragraph, chunk: 0 };
  const paragraph = position.paragraph + delta;
  if (paragraph < 0) return START;
  return paragraph < paragraphs.length ? { paragraph, chunk: 0 } : null;
}

/** A speed snapped to a quarter and kept in `SPEECH_RATE_LIMITS`. */
export function clampSpeechRate(value: unknown): number {
  const rate = typeof value === "number" && Number.isFinite(value) ? value : 1;
  const snapped = Math.round(rate * 4) / 4;
  return Math.min(SPEECH_RATE_LIMITS.max, Math.max(SPEECH_RATE_LIMITS.min, snapped));
}

/** "1,25×" / "1.25×" in the UI locale. */
export function speechRateLabel(rate: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(rate)}×`;
}

/** The fields both engines give for a voice (`SpeechSynthesisVoice`, `expo-speech` `Voice`). */
export interface SpeechVoiceInfo {
  id: string;
  name: string;
  lang: string;
  /** False for voices the system says run on a remote service (never offered). */
  local: boolean;
  default?: boolean;
}

const primary = (lang: string | null | undefined): string => (lang ?? "").toLowerCase().split(/[-_]/)[0] ?? "";

/**
 * Local voices for the article's language, else for the UI language, sorted (the system default
 * first, then by name). Empty when the system has no local voice at all.
 */
export function voicesFor(voices: readonly SpeechVoiceInfo[], articleLang: string | null | undefined, uiLang: string): SpeechVoiceInfo[] {
  const local = voices.filter((voice) => voice.local);
  const byLang = (lang: string) => local.filter((voice) => lang && primary(voice.lang) === lang);
  const list = byLang(primary(articleLang)).length ? byLang(primary(articleLang)) : byLang(primary(uiLang));
  return [...list].sort((a, b) => Number(!!b.default) - Number(!!a.default) || a.name.localeCompare(b.name));
}

/** The language spoken: the article's, else the UI's. */
export function speechLanguage(articleLang: string | null | undefined, uiLang: string): string {
  return articleLang && /^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i.test(articleLang) ? articleLang : uiLang;
}

/** The voice to use: the chosen one if it fits the language, else the first offered (null: the engine's default). */
export function pickVoice(offered: readonly SpeechVoiceInfo[], chosen: string): SpeechVoiceInfo | null {
  return offered.find((voice) => voice.id === chosen) ?? offered[0] ?? null;
}
