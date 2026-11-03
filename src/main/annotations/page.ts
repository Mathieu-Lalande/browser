import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { sanitizeQuote, type HighlightMark, type TextQuote } from "@shared/annotations/model";
import { ANNOTATOR_FACTORY, highlightCss } from "@shared/annotations/page-script";

/**
 * The page side of highlights on the desktop (ADR-037): the shared annotator runs in its own
 * isolated world (shared DOM, none of the page's JavaScript, no preload: ADR-003). Commands come
 * from main as scripts, results as their return values; a click on a highlight comes back as a
 * `console.debug` message tagged with a per-run secret prefix the page cannot see (same channel
 * as the swipe watcher, ADR-033), read by main from `console-message` (main frame only).
 */

/** Isolated worlds: 1001 cosmetics … 1012 translation; 1013 highlights. */
export const ANNOTATE_WORLD_ID = 1013;

const PREFIX = `browser-annotate:${randomUUID()}:`;

/** Created once per document in the isolated world. */
const ANNOTATOR = `(globalThis.__browserAnnotate || (globalThis.__browserAnnotate = ${ANNOTATOR_FACTORY}(function (message) {
  console.debug(${JSON.stringify(PREFIX)} + JSON.stringify(message));
})))`;

const CSS = highlightCss();

/** Pages whose current document has the highlight CSS. */
const styled = new WeakSet<WebContents>();

async function run(contents: WebContents, code: string): Promise<unknown> {
  if (contents.isDestroyed()) return null;
  try {
    if (!styled.has(contents)) {
      styled.add(contents);
      await contents.insertCSS(CSS);
    }
    return await contents.executeJavaScriptInIsolatedWorld(ANNOTATE_WORLD_ID, [{ code }]);
  } catch {
    return null;
  }
}

/** A new document (dom-ready): it has neither the CSS nor the annotator yet (both come on first use). */
export function documentChanged(contents: WebContents): void {
  styled.delete(contents);
}

export interface ApplyStatus {
  anchored: string[];
  missing: string[];
}

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(0, 10_000) : []);

/** Shows exactly `marks` in the page; null when the page did not answer. */
export async function applyMarks(contents: WebContents, marks: readonly HighlightMark[]): Promise<ApplyStatus | null> {
  const result = await run(contents, `${ANNOTATOR}.apply(${JSON.stringify(marks)})`);
  if (typeof result !== "object" || result === null) return null;
  const { anchored, missing } = result as { anchored?: unknown; missing?: unknown };
  return { anchored: ids(anchored), missing: ids(missing) };
}

export interface CapturedQuote {
  quote: TextQuote;
  /** Where the selection is, in CSS pixels of the page's viewport. */
  rect: [number, number, number, number] | null;
}

const rectOf = (value: unknown): [number, number, number, number] | null =>
  Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === "number" && Number.isFinite(n)) ? (value as [number, number, number, number]) : null;

/** The page's selection as a quote (validated: the page's text is untrusted). */
export async function captureSelection(contents: WebContents): Promise<CapturedQuote | null> {
  const result = await run(contents, `${ANNOTATOR}.capture()`);
  const quote = sanitizeQuote(result);
  return quote ? { quote, rect: rectOf((result as { rect?: unknown }).rect) } : null;
}

export const scrollToMark = async (contents: WebContents, id: string) => (await run(contents, `${ANNOTATOR}.scrollTo(${JSON.stringify(id)})`)) === true;

export interface MarkClick {
  id: string;
  rect: [number, number, number, number];
}

/** A click the annotator reported, or null for any other console message. */
export function parseAnnotatorMessage(message: string): MarkClick | null {
  if (!message.startsWith(PREFIX)) return null;
  try {
    const value = JSON.parse(message.slice(PREFIX.length)) as { type?: unknown; id?: unknown; rect?: unknown };
    const rect = rectOf(value.rect);
    return value.type === "click" && typeof value.id === "string" && rect ? { id: value.id, rect } : null;
  } catch {
    return null;
  }
}
