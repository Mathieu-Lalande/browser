import { displayUrl } from "../../url";
import { matchFields, weigh, type FieldMatch } from "../scorer";
import type { SectionId, Suggestion } from "../types";

/** URL shown under a title: `displayUrl`, but a data: URL is reduced to its media type. */
export function shortUrl(url: string): string {
  if (/^data:/i.test(url)) return url.slice(0, Math.max(5, url.search(/[;,]/)));
  return displayUrl(url);
}

/** A row with title and detail matched against `text` (null when it does not match). */
export function matchedRow(
  text: string,
  section: SectionId,
  row: Omit<Suggestion, "titleRanges" | "detailRanges" | "score" | "section">,
  options: { keywords?: readonly string[]; boost?: number; keepUnmatched?: boolean } = {},
): Suggestion | null {
  const match: FieldMatch | null = matchFields(text, row.title, row.detail, options.keywords) ?? (options.keepUnmatched ? { score: 0, titleRanges: [], detailRanges: [] } : null);
  if (!match) return null;
  return { ...row, section, titleRanges: match.titleRanges, detailRanges: match.detailRanges, score: weigh(section, match.score, options.boost) };
}

/** Removes nulls (providers build rows with `matchedRow`). */
export const present = <T>(rows: readonly (T | null)[]): T[] => rows.filter((row): row is T => row !== null);
