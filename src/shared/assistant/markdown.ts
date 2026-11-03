import { sanitizeReaderContent, type ReaderElement, type ReaderNode, type ReaderTag } from "../reader";

/**
 * The assistant's Markdown, drawn safely (ADR-044): parsed into the reader's JSON tree, then
 * checked by the reader's own sanitizer (ADR-026): a fixed list of tags, http(s) links only, no
 * image, no attribute, no HTML string anywhere. Raw HTML in the answer stays visible text.
 * Covers what answers use: headings, paragraphs, lists (nested), quotes, code, tables, rules,
 * strong/emphasis/strikethrough, inline code and links. No lookbehind (Hermes on the phone).
 */

const el = (tag: ReaderTag, children: ReaderNode[], extra?: Partial<ReaderElement>): ReaderElement => ({ tag, children, ...extra });

const INLINE =
  /(`+)([\s\S]*?[^`])\1(?!`)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\*([^*\s](?:[\s\S]*?[^*\s])?)\*|!\[([^\]]*)\]\([^)]*\)|\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|<(https?:\/\/[^>\s]+)>|\\([\\`*_{}[\]()#+\-.!~|>])/g;

/** Inline Markdown into reader nodes. */
export function parseInline(text: string): ReaderNode[] {
  const out: ReaderNode[] = [];
  const push = (node: ReaderNode) => {
    const last = out[out.length - 1];
    if (typeof node === "string" && typeof last === "string") out[out.length - 1] = last + node;
    else if (node !== "") out.push(node);
  };
  let index = 0;
  // Its own regex object: nested calls (strong inside a link…) keep their own position.
  const pattern = new RegExp(INLINE.source, "g");
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    push(text.slice(index, match.index));
    index = match.index + match[0].length;
    const [, ticks, code, strong, strong2, strike, em, imageAlt, linkText, href, autolink, escaped] = match;
    if (ticks) push(el("code", [code.replace(/^ (.*) $/, "$1")]));
    else if (strong !== undefined || strong2 !== undefined) push(el("strong", parseInline(strong ?? strong2)));
    else if (strike !== undefined) push(el("s", parseInline(strike)));
    else if (em !== undefined) push(el("em", parseInline(em)));
    else if (imageAlt !== undefined) push(imageAlt);
    else if (linkText !== undefined) push(el("a", parseInline(linkText), { href }));
    else if (autolink !== undefined) push(el("a", [autolink], { href: autolink }));
    else if (escaped !== undefined) push(escaped);
  }
  push(text.slice(index));
  return out;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}> ?/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const indentOf = (line: string) => line.length - line.trimStart().length;
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

const startsBlock = (line: string, next: string | undefined) =>
  FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line) || (line.includes("|") && next !== undefined && TABLE_RULE.test(next));

function parseBlocks(lines: readonly string[]): ReaderNode[] {
  const out: ReaderNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trimStart().startsWith(fence[1])) body.push(lines[index++]);
      index++;
      out.push(el("pre", [el("code", [body.join("\n") || " "])]));
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      out.push(el(`h${Math.min(6, heading[1].length + 1)}` as ReaderTag, parseInline(heading[2])));
      index++;
      continue;
    }
    if (RULE.test(line)) {
      out.push(el("hr", []));
      index++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index])) body.push(lines[index++].replace(QUOTE, ""));
      out.push(el("blockquote", parseBlocks(body)));
      continue;
    }
    if (line.includes("|") && index + 1 < lines.length && TABLE_RULE.test(lines[index + 1])) {
      const head = cells(line);
      index += 2;
      const rows: ReaderNode[] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        const row = cells(lines[index++]);
        rows.push(el("tr", head.map((_, cell) => el("td", parseInline(row[cell] ?? "")))));
      }
      out.push(el("table", [el("thead", [el("tr", head.map((cell) => el("th", parseInline(cell))))]), el("tbody", rows)]));
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      const { node, next } = parseList(lines, index);
      out.push(node);
      index = next;
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && (!paragraph.length || !startsBlock(lines[index], lines[index + 1]))) paragraph.push(lines[index++].trim());
    out.push(el("p", parseInline(paragraph.join("\n"))));
  }
  return out;
}

/** A list starting at `start`: its items at that indent, deeper lines parsed as their content. */
function parseList(lines: readonly string[], start: number): { node: ReaderElement; next: number } {
  const first = ITEM.exec(lines[start])!;
  const base = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items: ReaderNode[] = [];
  let index = start;
  while (index < lines.length) {
    const match = ITEM.exec(lines[index]);
    if (!match || match[1].length !== base || /\d/.test(match[2]) !== ordered) break;
    const body = [match[3]];
    index++;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        // A blank line ends the list unless an indented continuation follows.
        if (index + 1 < lines.length && lines[index + 1].trim() && indentOf(lines[index + 1]) > base) {
          body.push("");
          index++;
          continue;
        }
        break;
      }
      const nested = ITEM.exec(line);
      if (indentOf(line) <= base && (nested || startsBlock(line, lines[index + 1]))) break;
      body.push(indentOf(line) > base ? line.slice(Math.min(indentOf(line), base + 2)) : line.trim());
      index++;
    }
    const blocks = parseBlocks(body);
    // A tight item: its first paragraph is unwrapped (a nested list may follow it).
    const [head, ...rest] = blocks;
    const children = head && typeof head !== "string" && head.tag === "p" && !body.includes("") ? [...head.children, ...rest] : blocks;
    items.push(el("li", children.length ? children : [" "]));
    if (index < lines.length && !lines[index].trim()) break;
  }
  return { node: el(ordered ? "ol" : "ul", items), next: index };
}

/** Markdown into a sanitized reader tree. */
export function markdownToNodes(markdown: string): ReaderNode[] {
  return sanitizeReaderContent(parseBlocks(markdown.replace(/\r\n?/g, "\n").split("\n")));
}
