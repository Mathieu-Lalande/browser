import { COMMANDS, commandLabel, isCommandAvailable, type CommandContext, type CommandDefinition } from "./commands";
import { fuzzyMatch, type Range } from "./fuzzy";
import type { Suggestion } from "./search";
import type { TabId, TabState } from "./types";
import { displayUrl, normalizeInput, searchUrl } from "./url";

/** Command palette results: which rows to show for a query, in which sections. Pure, no UI. */

interface Row {
  /** Stable across keystrokes (keyed lists). */
  key: string;
  title: string;
  titleRanges: Range[];
  /** Secondary text (URL), if any. */
  detail: string;
  detailRanges: Range[];
}

export type PaletteItem = Row &
  (
    | { kind: "tab"; tab: TabState }
    | { kind: "command"; command: CommandDefinition }
    | { kind: "bookmark" | "history"; url: string; favicon: string | null }
    /** "Aller à …" (the input is an address) or "Rechercher sur le web « … »". */
    | { kind: "navigate" | "search"; url: string }
  );

export interface PaletteSection {
  id: "go" | "tabs" | "commands" | "suggestions" | "web";
  /** Null for sections without a header. */
  title: string | null;
  items: PaletteItem[];
}

export interface PaletteInput {
  query: string;
  tabs: readonly TabState[];
  activeTabId: TabId | null;
  /** Bookmarks and history matching the query, best first (`mergeSuggestions`). */
  suggestions: readonly Suggestion[];
  context: CommandContext;
}

const MAX_TABS = 6;
const MAX_COMMANDS = 6;
const MAX_SUGGESTIONS = 6;
/** Keyword matches rank below label matches. */
const KEYWORD_WEIGHT = 0.75;

const noRanges: Range[] = [];

/** URL matches rank a little below title matches. */
const DETAIL_WEIGHT = 0.9;

/**
 * Matches each query token in the title or the detail (URL), whichever matches it best: "wiki fr"
 * may match the title and the URL, but a single token never spans both.
 */
function matchRow(query: string, title: string, detail: string): { score: number; titleRanges: Range[]; detailRanges: Range[] } | null {
  let score = 0;
  const titleRanges: Range[] = [];
  const detailRanges: Range[] = [];
  for (const token of query.split(/\s+/).filter(Boolean)) {
    const inTitle = fuzzyMatch(token, title);
    const inDetail = detail ? fuzzyMatch(token, detail) : null;
    if (inTitle && (!inDetail || inTitle.score >= inDetail.score * DETAIL_WEIGHT)) {
      score += inTitle.score;
      titleRanges.push(...inTitle.ranges);
    } else if (inDetail) {
      score += inDetail.score * DETAIL_WEIGHT;
      detailRanges.push(...inDetail.ranges);
    } else {
      return null;
    }
  }
  return { score, titleRanges: mergeRanges(titleRanges), detailRanges: mergeRanges(detailRanges) };
}

function mergeRanges(ranges: Range[]): Range[] {
  const merged: Range[] = [];
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
    const previous = merged.at(-1);
    if (previous && previous[1] >= start) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** URL shown under a title: `displayUrl`, but a data: URL is reduced to its media type. */
function shortUrl(url: string): string {
  if (/^data:/i.test(url)) return url.slice(0, Math.max(5, url.search(/[;,]/)));
  return displayUrl(url);
}

function tabRow(tab: TabState): Omit<PaletteItem & { kind: "tab" }, "titleRanges" | "detailRanges"> {
  return { kind: "tab", key: `tab:${tab.id}`, tab, title: tab.title, detail: shortUrl(tab.url) };
}

function commandRows(query: string, context: CommandContext): { item: PaletteItem; score: number }[] {
  const rows: { item: PaletteItem; score: number }[] = [];
  for (const command of COMMANDS) {
    if (!isCommandAvailable(command, context)) continue;
    const title = commandLabel(command, context);
    const base = { kind: "command" as const, key: `command:${command.id}`, command, title, detail: "", detailRanges: noRanges };
    const match = fuzzyMatch(query, title);
    if (match) {
      rows.push({ item: { ...base, titleRanges: match.ranges }, score: match.score });
      continue;
    }
    const keyword = Math.max(...command.keywords.map((word) => fuzzyMatch(query, word)?.score ?? -Infinity));
    if (keyword > -Infinity) rows.push({ item: { ...base, titleRanges: noRanges }, score: keyword * KEYWORD_WEIGHT });
  }
  return rows;
}

const byScore = (a: { score: number }, b: { score: number }) => b.score - a.score;

/** Sections to show: recent tabs and every action before typing, ranked matches after. */
export function buildPalette({ query, tabs, activeTabId, suggestions, context }: PaletteInput): PaletteSection[] {
  const text = query.trim();
  if (!text) {
    const recent = tabs
      .filter((tab) => tab.id !== activeTabId)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .slice(0, MAX_TABS)
      .map((tab): PaletteItem => ({ ...tabRow(tab), titleRanges: noRanges, detailRanges: noRanges }));
    const sections: PaletteSection[] = [
      { id: "tabs", title: "Onglets récents", items: recent },
      { id: "commands", title: "Actions", items: commandRows("", context).map(({ item }) => item) },
    ];
    return sections.filter((section) => section.items.length > 0);
  }

  const tabRows = tabs
    .map((tab) => {
      const row = tabRow(tab);
      const match = matchRow(text, row.title, row.detail);
      return match && { item: { ...row, titleRanges: match.titleRanges, detailRanges: match.detailRanges } as PaletteItem, score: match.score };
    })
    .filter((row) => row !== null)
    .sort(byScore)
    .slice(0, MAX_TABS);

  const commands = commandRows(text, context).sort(byScore).slice(0, MAX_COMMANDS);

  // Already ranked by main (match quality × frecency): keep their order, skip pages open in a tab.
  const open = new Set(tabs.map((tab) => tab.url));
  const pages = suggestions
    .filter((suggestion) => !open.has(suggestion.url))
    .slice(0, MAX_SUGGESTIONS)
    .map((suggestion) => {
      const title = suggestion.title || displayUrl(suggestion.url);
      const detail = shortUrl(suggestion.url);
      const match = matchRow(text, title, detail);
      const item: PaletteItem = {
        kind: suggestion.kind,
        key: `${suggestion.kind}:${suggestion.url}`,
        url: suggestion.url,
        favicon: suggestion.favicon,
        title,
        titleRanges: match?.titleRanges ?? noRanges,
        detail,
        detailRanges: match?.detailRanges ?? noRanges,
      };
      return { item, score: match?.score ?? 0 };
    });

  // Sections follow their best match: typing "dupl" puts the action first, "github" the pages.
  const ranked = [
    { id: "tabs" as const, title: "Onglets", rows: tabRows },
    { id: "commands" as const, title: "Actions", rows: commands },
    { id: "suggestions" as const, title: "Favoris et historique", rows: pages },
  ]
    .filter((section) => section.rows.length > 0)
    .map((section) => ({ ...section, best: Math.max(...section.rows.map((row) => row.score)) }))
    .sort((a, b) => b.best - a.best)
    .map(({ id, title, rows }): PaletteSection => ({ id, title, items: rows.map((row) => row.item) }));

  const url = normalizeInput(text);
  const isSearch = url === searchUrl(text);
  const web: PaletteItem = isSearch
    ? { kind: "search", key: "search", url, title: `Rechercher sur le web « ${text} »`, titleRanges: noRanges, detail: "", detailRanges: noRanges }
    : { kind: "navigate", key: "navigate", url, title: `Aller à ${displayUrl(url)}`, titleRanges: noRanges, detail: "", detailRanges: noRanges };
  // An address goes first (that is what the user typed); a web search is the fallback, last.
  return isSearch
    ? [...ranked, { id: "web", title: "Web", items: [web] }]
    : [{ id: "go", title: null, items: [web] }, ...ranked];
}
