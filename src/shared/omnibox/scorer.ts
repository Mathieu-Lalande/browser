import { t } from "../i18n";
import { fuzzyMatch, type Range } from "../fuzzy";
import type { Section, SectionId, Suggestion } from "./types";

/**
 * The pure scorer of the universal bar: how well a row matches the text (fuzzy, per field), how
 * much each provider weighs, and how sections are ordered and capped.
 */

export interface FieldMatch {
  score: number;
  titleRanges: Range[];
  detailRanges: Range[];
}

/** URL/detail matches rank a little below title matches. */
export const DETAIL_WEIGHT = 0.9;
/** Keyword-only matches rank below label matches. */
export const KEYWORD_WEIGHT = 0.75;

/** Relative weight of each provider's matches, for the same match quality. */
export const SECTION_WEIGHTS: Record<SectionId, number> = {
  scopes: 10,
  answer: 10,
  go: 10,
  tabs: 1.1,
  favorites: 1.05,
  bookmarks: 1,
  commands: 1,
  history: 0.95,
  settings: 0.9,
  remote: 0.8,
  archived: 0.7,
  notes: 0.75,
  assistant: 10,
  web: 0,
};

/** Rows kept per section (a long section must not push the others out of sight). */
export const SECTION_LIMITS: Record<SectionId, number> = {
  scopes: 5,
  answer: 1,
  go: 1,
  tabs: 6,
  favorites: 4,
  bookmarks: 4,
  history: 6,
  commands: 6,
  settings: 5,
  remote: 4,
  archived: 4,
  notes: 4,
  assistant: 2,
  web: 4,
};

/** Larger limits while a scope narrows the bar to one kind of result. */
export const SCOPED_LIMIT = 40;

export const SECTION_TITLES: Record<SectionId, string | null> = {
  scopes: "Filtres",
  answer: null,
  go: null,
  get tabs() { return t("omniboxScorer.tabs") },
  get favorites() { return t("omniboxScorer.pinnedFavorites") },
  get bookmarks() { return t("omniboxScorer.bookmarks") },
  get history() { return t("omniboxScorer.history") },
  commands: "Actions",
  get settings() { return t("omniboxScorer.settings") },
  get remote() { return t("omniboxScorer.tabsFromMyOther") },
  get archived() { return t("omniboxScorer.archivedTabs") },
  get notes() { return t("omniboxScorer.notesHighlights") },
  assistant: "Assistant IA",
  web: "Web",
};

/** Sections always first, in this order, whatever their score. */
const PINNED_FIRST: readonly SectionId[] = ["scopes", "answer", "go"];
/** Sections always last (the web search is the fallback). */
const PINNED_LAST: readonly SectionId[] = ["web"];

const noRanges: Range[] = [];

function mergeRanges(ranges: Range[]): Range[] {
  const merged: Range[] = [];
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const previous = merged.at(-1);
    if (previous && previous[1] >= start) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/**
 * Matches each token of `text` in the title or the detail, whichever matches it best ("wiki fr"
 * may match the title and the URL, a single token never spans both); keywords are a fallback for
 * the whole text. Null when a token matches nowhere. An empty text matches with a zero score.
 */
export function matchFields(text: string, title: string, detail = "", keywords: readonly string[] = []): FieldMatch | null {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { score: 0, titleRanges: noRanges, detailRanges: noRanges };
  let score = 0;
  const titleRanges: Range[] = [];
  const detailRanges: Range[] = [];
  let matched = true;
  for (const token of tokens) {
    const inTitle = fuzzyMatch(token, title);
    const inDetail = detail ? fuzzyMatch(token, detail) : null;
    if (inTitle && (!inDetail || inTitle.score >= inDetail.score * DETAIL_WEIGHT)) {
      score += inTitle.score;
      titleRanges.push(...inTitle.ranges);
    } else if (inDetail) {
      score += inDetail.score * DETAIL_WEIGHT;
      detailRanges.push(...inDetail.ranges);
    } else {
      matched = false;
      break;
    }
  }
  if (matched) {
    return { score, titleRanges: mergeRanges(titleRanges), detailRanges: mergeRanges(detailRanges) };
  }
  let best = -Infinity;
  for (const keyword of keywords) best = Math.max(best, fuzzyMatch(text, keyword)?.score ?? -Infinity);
  return best > -Infinity ? { score: best * KEYWORD_WEIGHT, titleRanges: noRanges, detailRanges: noRanges } : null;
}

/** A provider's match, weighed for its section; `boost` adds recency/frecency (0…1, a few points). */
export function weigh(section: SectionId, matchScore: number, boost = 0): number {
  return matchScore * SECTION_WEIGHTS[section] + boost * 8;
}

/** Recency boost in 0…1: 1 now, half after `halfLifeMs`. */
export function recency(at: number, now: number, halfLifeMs = 3 * 24 * 3600 * 1000): number {
  return 0.5 ** (Math.max(0, now - at) / halfLifeMs);
}

/** Rank-order boost for lists already ranked elsewhere (history by frecency): 1 for the first. */
export const rankBoost = (index: number) => 1 / (1 + index);

const byScore = (a: Suggestion, b: Suggestion) => b.score - a.score;

/**
 * Groups suggestions into sections: rows sorted by score and capped, sections ordered by their
 * best row (typing "dupl" puts the action first, "github" the pages), pinned sections aside.
 */
export function rank(suggestions: readonly Suggestion[], options: { scoped?: boolean; keepOrder?: boolean; limits?: Partial<Record<SectionId, number>> } = {}): Section[] {
  const groups = new Map<SectionId, Suggestion[]>();
  for (const suggestion of suggestions) {
    const group = groups.get(suggestion.section);
    if (group) group.push(suggestion);
    else groups.set(suggestion.section, [suggestion]);
  }
  const sections: (Section & { best: number })[] = [];
  for (const [id, rows] of groups) {
    const sorted = options.keepOrder ? rows : [...rows].sort(byScore);
    const items = sorted.slice(0, options.scoped ? SCOPED_LIMIT : (options.limits?.[id] ?? SECTION_LIMITS[id]));
    sections.push({ id, title: SECTION_TITLES[id], items, best: items[0].score });
  }
  const order = (section: SectionId) =>
    PINNED_FIRST.includes(section) ? -1 - (PINNED_FIRST.length - PINNED_FIRST.indexOf(section)) : PINNED_LAST.includes(section) ? 1 : 0;
  sections.sort((a, b) => order(a.id) - order(b.id) || (options.keepOrder ? 0 : b.best - a.best));
  return sections.map(({ id, title, items }) => ({ id, title, items }));
}
