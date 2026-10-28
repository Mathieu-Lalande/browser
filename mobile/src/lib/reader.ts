import { READER_EXTRACT_SCRIPT, sanitizeReaderArticle, type ReaderArticle, type ReaderNode } from "@shared/reader";

/**
 * Reader mode on the phone (ADR-026). WebViews have no usable isolated world: the extraction
 * script runs in the page's own world and posts its result through the existing bridge, which
 * any page can imitate. The message is therefore untrusted: it must carry the token of the
 * request the user just made, is size-checked, and goes through the shared sanitizer with the
 * tab's own URL (never one the message names). The article is drawn natively (`Text`), not as
 * HTML: images are left out (an RN `Image` would fetch them outside the tab's WebView session),
 * their description is kept as text.
 */

export const READER_MESSAGE = "browser-reader";
/** Larger messages are ignored (the sanitizer bounds the article far below this). */
const MAX_MESSAGE_LENGTH = 4_000_000;

/** Injected on request: posts `{ type, token, article }`. */
export function readerScript(token: string): string {
  return `(function () {
  var article = null;
  try { article = ${READER_EXTRACT_SCRIPT}; } catch (e) {}
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: ${JSON.stringify(READER_MESSAGE)}, token: ${JSON.stringify(token)}, article: article }));
})();
true;`;
}

/**
 * A reader answer for the pending request `token` on the tab showing `url`: `undefined` when the
 * message is not one (other bridge messages), else the validated article or null.
 */
export function parseReaderMessage(data: string, token: string | null, url: string): ReaderArticle | null | undefined {
  if (data.length > MAX_MESSAGE_LENGTH || !data.includes(READER_MESSAGE)) return undefined;
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (typeof message !== "object" || message === null) return undefined;
  const { type, token: received, article } = message as Record<string, unknown>;
  if (type !== READER_MESSAGE) return undefined;
  if (!token || received !== token) return null;
  return sanitizeReaderArticle(article, url);
}

/** A random request token (not secret from the page, which sees the script: it only ties answers to requests). */
export function readerToken(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** "Version ordinateur": what the WebView announces (Safari on a Mac on iOS, desktop Chrome elsewhere). */
export function desktopUserAgent(os: string): string {
  return os === "ios"
    ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
    : "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
}

/** A run of text with its inline style, as React Native `Text` draws it. */
export interface ReaderSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string;
}

/** One block of the native reader. */
export type ReaderBlock =
  | { kind: "paragraph" | "quote" | "caption"; spans: ReaderSpan[] }
  | { kind: "heading"; level: 2 | 3 | 4; spans: ReaderSpan[] }
  | { kind: "pre"; text: string }
  | { kind: "item"; marker: string; depth: number; spans: ReaderSpan[] }
  | { kind: "rule" };

type Style = Omit<ReaderSpan, "text">;

const BLOCK_TAGS = new Set(["p", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "ul", "ol", "li", "hr", "figure", "figcaption", "table", "thead", "tbody", "tr", "caption", "dl", "dt", "dd", "div", "img"]);

/**
 * Flattens a validated reader tree into native blocks: headings, paragraphs, quotes, list items
 * (with their marker and depth), code blocks and rules; inline styles become spans. Table cells
 * are read row by row. Images become their description (see above).
 */
export function readerBlocks(nodes: readonly ReaderNode[]): ReaderBlock[] {
  const blocks: ReaderBlock[] = [];
  let spans: ReaderSpan[] = [];
  let paragraphKind: "paragraph" | "quote" | "caption" = "paragraph";

  const flush = () => {
    const trimmed = trimSpans(spans);
    if (trimmed.length) blocks.push({ kind: paragraphKind, spans: trimmed });
    spans = [];
  };

  const inline = (node: ReaderNode, style: Style) => {
    if (typeof node === "string") {
      if (node) spans.push({ ...style, text: node });
      return;
    }
    if (node.tag === "br") {
      spans.push({ ...style, text: "\n" });
      return;
    }
    if (node.tag === "img") {
      if (node.alt) spans.push({ ...style, italic: true, text: `[${node.alt}]` });
      return;
    }
    const next: Style = { ...style };
    if (node.tag === "strong" || node.tag === "th" || node.tag === "dt") next.bold = true;
    if (node.tag === "em") next.italic = true;
    if (node.tag === "code") next.code = true;
    if (node.tag === "a" && node.href) next.href = node.href;
    for (const child of node.children) visit(child, next, 0, "paragraph");
    if (node.tag === "td" || node.tag === "th") spans.push({ ...style, text: "  " });
  };

  const visit = (node: ReaderNode, style: Style, depth: number, kind: "paragraph" | "quote" | "caption") => {
    if (typeof node === "string" || !BLOCK_TAGS.has(node.tag)) {
      paragraphKind = kind;
      inline(node, style);
      return;
    }
    switch (node.tag) {
      case "hr":
        flush();
        blocks.push({ kind: "rule" });
        return;
      case "img":
        flush();
        if (node.alt) blocks.push({ kind: "caption", spans: [{ italic: true, text: node.alt }] });
        return;
      case "pre": {
        flush();
        const text = textOf(node.children).replace(/\n+$/, "");
        if (text) blocks.push({ kind: "pre", text });
        return;
      }
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        flush();
        const level = node.tag === "h2" ? 2 : node.tag === "h3" ? 3 : 4;
        for (const child of node.children) inline(child, style);
        const trimmed = trimSpans(spans);
        spans = [];
        if (trimmed.length) blocks.push({ kind: "heading", level, spans: trimmed });
        return;
      }
      case "ul":
      case "ol": {
        flush();
        let ordinal = 0;
        for (const child of node.children) {
          if (typeof child !== "string" && child.tag === "li") {
            ordinal++;
            item(child, node.tag === "ol" ? `${ordinal}.` : "•", depth, style);
          } else visit(child, style, depth, kind);
        }
        flush();
        return;
      }
      case "li":
        item(node, "•", depth, style);
        return;
      default: {
        // Paragraph-like containers: p, blockquote, figure, figcaption, div, tables, dl…
        const childKind = node.tag === "blockquote" ? "quote" : node.tag === "figcaption" || node.tag === "caption" ? "caption" : kind;
        flush();
        for (const child of node.children) visit(child, style, depth, childKind);
        paragraphKind = childKind;
        flush();
      }
    }
  };

  /** A list item: its own text as one block, nested lists one level deeper. */
  const item = (node: Extract<ReaderNode, object>, marker: string, depth: number, style: Style) => {
    flush();
    const start = blocks.length;
    for (const child of node.children) visit(child, style, depth + 1, "paragraph");
    const own = trimSpans(spans);
    spans = [];
    // The item's first text block takes the marker; inline text not yet flushed is that text.
    if (own.length) blocks.splice(start, 0, { kind: "item", marker, depth, spans: own });
    else {
      const first = blocks[start];
      if (first && first.kind === "paragraph") blocks[start] = { kind: "item", marker, depth, spans: first.spans };
    }
  };

  for (const node of nodes) visit(node, {}, 0, "paragraph");
  flush();
  return blocks;
}

function textOf(nodes: readonly ReaderNode[]): string {
  return nodes.map((node) => (typeof node === "string" ? node : node.tag === "br" ? "\n" : textOf(node.children))).join("");
}

/** Drops leading/trailing blank runs (whitespace between blocks), keeping inner spacing. */
function trimSpans(spans: ReaderSpan[]): ReaderSpan[] {
  const out = spans.filter((span) => span.text);
  while (out.length && !out[0].text.trim()) out.shift();
  while (out.length && !out[out.length - 1].text.trim()) out.pop();
  if (out.length) {
    out[0] = { ...out[0], text: out[0].text.replace(/^\s+/, "") };
    const last = out.length - 1;
    out[last] = { ...out[last], text: out[last].text.replace(/\s+$/, "") };
  }
  return out;
}
