/**
 * Text segments of page translation (ADR-036): what a page script hands over (untrusted: shape and
 * sizes checked here), how they are grouped into provider requests, and how a translation is fitted
 * back. Segments are plain text: the page side writes them with `nodeValue`, never as HTML, so a
 * translation (or a hostile provider) can never inject markup.
 */

/** One text node's text, trimmed by the page script (it keeps the surrounding spaces itself). */
export interface Segment {
  id: number;
  text: string;
}

/** Longest segment accepted (a longer text node is left untranslated). */
export const MAX_SEGMENT_CHARS = 4000;
/** Segments accepted from the page per batch. */
export const MAX_BATCH_SEGMENTS = 200;
/** Characters sent per batch from the page (several provider requests may carry it). */
export const MAX_BATCH_CHARS = 20_000;

const LETTER = /\p{L}/u;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * A batch as the page script returned it (`[[id, text], …]`) → valid segments: integer ids, each
 * once, non-empty text with at least one letter, within the size limits. Anything else is dropped.
 */
export function sanitizeSegments(value: unknown): Segment[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const segments: Segment[] = [];
  let chars = 0;
  for (const item of value.slice(0, MAX_BATCH_SEGMENTS)) {
    if (!Array.isArray(item) || item.length !== 2) continue;
    const [id, text] = item as unknown[];
    if (!Number.isSafeInteger(id) || (id as number) < 1 || seen.has(id as number)) continue;
    if (typeof text !== "string" || !text.trim() || text.length > MAX_SEGMENT_CHARS || !LETTER.test(text)) continue;
    if (chars + text.length > MAX_BATCH_CHARS) break;
    seen.add(id as number);
    chars += text.length;
    segments.push({ id: id as number, text });
  }
  return segments;
}

/**
 * Groups texts into provider requests of at most `maxItems` texts and `maxChars` characters, in
 * order. A text longer than `maxChars` goes alone in its request. Returns index ranges `[start, end)`.
 */
export function chunkTexts(texts: readonly string[], maxChars: number, maxItems: number): [number, number][] {
  const chunks: [number, number][] = [];
  let start = 0;
  let chars = 0;
  texts.forEach((text, index) => {
    const full = index - start >= maxItems || (index > start && chars + text.length > maxChars);
    if (full) {
      chunks.push([start, index]);
      start = index;
      chars = 0;
    }
    chars += text.length;
  });
  if (start < texts.length) chunks.push([start, texts.length]);
  return chunks;
}

/**
 * A provider's translation of `original`, made safe to write back as text: a string, without
 * control characters, trimmed (the page keeps the original's surrounding spaces) and bounded
 * (four times the original plus some room). Null when there is nothing usable: the text stays.
 */
export function fitTranslation(original: string, translated: unknown): string | null {
  if (typeof translated !== "string") return null;
  const text = translated.replace(CONTROL, "").trim();
  if (!text) return null;
  return text.slice(0, original.length * 4 + 64);
}
