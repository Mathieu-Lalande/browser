import type { ReaderNode } from "../reader";

/**
 * Context packing (ADR-044): what of the pages goes into a request. Page text comes from the
 * reader extraction (or the page's visible text), and is cut to a token estimate so a request
 * stays bounded in size and cost. A cut is never silent: each packed source says it was
 * truncated, and the UI shows it next to what was sent.
 */

/** Tokens for all the pages of one request (shared between them). */
export const CONTEXT_TOKEN_BUDGET = 48_000;
/** Tokens for a selected passage. */
export const SELECTION_TOKEN_BUDGET = 8_000;
/** A source given less than this is not worth sending. */
const MIN_SOURCE_TOKENS = 200;
/** Characters per token, deliberately low (French and code tokenize densely): estimates err high. */
const CHARS_PER_TOKEN = 3.5;
export const TRUNCATION_MARK = "[…]";

export interface ContextSource {
  title: string;
  url: string;
  text: string;
}

export interface PackedSource extends ContextSource {
  /** The text was cut to fit (the UI says so). */
  truncated: boolean;
  /** Estimated tokens of the packed text. */
  tokens: number;
}

/** What the UI shows of a request's context (never the text itself). */
export interface SentSource {
  title: string;
  url: string;
  truncated: boolean;
  /** No text could be read (sleeping tab, empty page): nothing of it was sent. */
  empty?: boolean;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** `text` cut to about `maxTokens`, at a paragraph, line or sentence end close to the limit. */
export function truncateToTokens(text: string, maxTokens: number): { text: string; truncated: boolean } {
  const maxChars = Math.max(0, Math.floor(maxTokens * CHARS_PER_TOKEN));
  if (text.length <= maxChars) return { text, truncated: false };
  if (maxChars === 0) return { text: "", truncated: true };
  const head = text.slice(0, maxChars);
  // A boundary in the last fifth, else a word end, else the raw cut.
  const floor = Math.floor(maxChars * 0.8);
  const boundary = Math.max(head.lastIndexOf("\n"), head.lastIndexOf(". ") + 1);
  const space = head.lastIndexOf(" ");
  const end = boundary >= floor ? boundary : space >= floor ? space : maxChars;
  return { text: `${head.slice(0, end).trimEnd()}\n${TRUNCATION_MARK}`, truncated: true };
}

/** Whitespace tidied: runs of spaces collapsed, at most one blank line in a row. */
export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const BLOCKS = new Set(["p", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "ul", "ol", "li", "figure", "figcaption", "table", "tr", "caption", "dl", "dt", "dd", "div", "hr"]);

/** Plain text of a reader tree, blocks on their own lines (the model reads the structure). */
export function readerPlainText(nodes: readonly ReaderNode[]): string {
  const parts: string[] = [];
  const walk = (list: readonly ReaderNode[]) => {
    for (const node of list) {
      if (typeof node === "string") parts.push(node);
      else if (node.tag === "br") parts.push("\n");
      else if (node.tag === "img") parts.push(node.alt ? ` ${node.alt} ` : "");
      else {
        const block = BLOCKS.has(node.tag);
        if (block) parts.push("\n\n");
        if (node.tag === "li") parts.push("- ");
        if (/^h[2-6]$/.test(node.tag)) parts.push(`${"#".repeat(Number(node.tag[1]))} `);
        if (node.tag === "td" || node.tag === "th") parts.push(" | ");
        walk(node.children);
        if (block) parts.push("\n\n");
      }
    }
  };
  walk(nodes);
  return tidyText(parts.join(""));
}

/**
 * Shares `budget` tokens between sources: each gets an equal share, and what short ones leave is
 * handed to the longer ones (so one long page next to a short one keeps most of its text).
 */
export function packSources(sources: readonly ContextSource[], budget = CONTEXT_TOKEN_BUDGET): PackedSource[] {
  const texts = sources.map((source) => tidyText(source.text));
  const needs = texts.map(estimateTokens);
  const shares = new Array<number>(sources.length).fill(0);
  let left = budget;
  let open = needs.map((_, index) => index).filter((index) => needs[index] > 0);
  while (open.length && left > 0) {
    const share = Math.floor(left / open.length);
    if (share <= 0) break;
    const next: number[] = [];
    for (const index of open) {
      const give = Math.min(share, needs[index] - shares[index]);
      shares[index] += give;
      left -= give;
      if (shares[index] < needs[index]) next.push(index);
    }
    // Everyone still open took a full share: only the rounding remainder is left.
    if (next.length === open.length) break;
    open = next;
  }
  return sources.map((source, index) => {
    const fits = shares[index] >= needs[index];
    const cut = truncateToTokens(texts[index], fits || shares[index] >= MIN_SOURCE_TOKENS ? shares[index] : 0);
    return { title: source.title, url: source.url, text: cut.text, truncated: cut.truncated, tokens: estimateTokens(cut.text) };
  });
}

/** What the UI lists for packed sources. */
export const sentSources = (packed: readonly PackedSource[]): SentSource[] =>
  packed.map(({ title, url, truncated, text }) => ({ title, url, truncated, ...(text ? {} : { empty: true }) }));
