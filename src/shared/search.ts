import type { Bookmark, HistoryEntry } from "./types";

/** Text matching and ranking shared by history search (main) and address-bar suggestions (UI). */

const DAY_MS = 24 * 60 * 60 * 1000;
/** A visit loses half of its weight every two weeks. */
const HALF_LIFE_DAYS = 14;

/** Match quality per query token: domain prefix > start of a word > anywhere. */
const HOST_PREFIX = 4;
const WORD_PREFIX = 2;
const SUBSTRING = 1;

export interface Suggestion {
  kind: "bookmark" | "history";
  url: string;
  title: string;
  favicon: string | null;
}

/** Lower-cased, whitespace-separated query terms. */
export function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** `https://www.example.com/a` → `example.com/a`: what users actually type. */
function stripUrl(url: string): string {
  return url.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
}

const isWordChar = (char: string) => /[\p{L}\p{N}]/u.test(char);

function hasWordPrefix(haystack: string, token: string): boolean {
  for (let index = haystack.indexOf(token); index !== -1; index = haystack.indexOf(token, index + 1)) {
    if (index === 0 || !isWordChar(haystack[index - 1])) return true;
  }
  return false;
}

/**
 * How well `url` + `title` match every token (0 = at least one token is missing).
 * The score is the average per-token quality, between 1 and 4.
 */
export function matchScore(tokens: readonly string[], url: string, title: string): number {
  if (tokens.length === 0) return 0;
  const stripped = stripUrl(url);
  const host = stripped.split(/[/?#]/, 1)[0];
  const text = `${stripped} ${title.toLowerCase()}`;
  let total = 0;
  for (const token of tokens) {
    if (host.startsWith(token)) total += HOST_PREFIX;
    else if (hasWordPrefix(text, token)) total += WORD_PREFIX;
    else if (text.includes(token)) total += SUBSTRING;
    else return 0;
  }
  return total / tokens.length;
}

/** Frequency × recency: more visits count more, older visits decay exponentially. */
export function frecency(visitCount: number, lastVisit: number, now: number): number {
  const ageDays = Math.max(0, now - lastVisit) / DAY_MS;
  return (1 + Math.log(Math.max(1, visitCount))) * 0.5 ** (ageDays / HALF_LIFE_DAYS);
}

type Visited = Pick<HistoryEntry, "url" | "title" | "visitCount" | "lastVisit">;

/** History entries matching `query`, best first (match quality × frecency). */
export function rankHistory<T extends Visited>(entries: Iterable<T>, query: string, limit: number, now: number): T[] {
  const tokens = tokenize(query);
  if (tokens.length === 0 || limit <= 0) return [];
  const scored: { entry: T; score: number }[] = [];
  for (const entry of entries) {
    const match = matchScore(tokens, entry.url, entry.title);
    if (match > 0) scored.push({ entry, score: match * frecency(entry.visitCount, entry.lastVisit, now) });
  }
  scored.sort((a, b) => b.score - a.score || b.entry.lastVisit - a.entry.lastVisit);
  return scored.slice(0, limit).map(({ entry }) => entry);
}

/** Most frecent entries, one per host so a single site cannot fill the start page. */
export function topSites<T extends Visited>(entries: Iterable<T>, limit: number, now: number): T[] {
  const sorted = [...entries].sort(
    (a, b) => frecency(b.visitCount, b.lastVisit, now) - frecency(a.visitCount, a.lastVisit, now),
  );
  const hosts = new Set<string>();
  const result: T[] = [];
  for (const entry of sorted) {
    if (result.length >= limit) break;
    const host = stripUrl(entry.url).split(/[/?#]/, 1)[0];
    if (hosts.has(host)) continue;
    hosts.add(host);
    result.push(entry);
  }
  return result;
}

/** At most this many bookmarks lead the suggestion list, so history stays visible. */
const MAX_BOOKMARK_SUGGESTIONS = 3;

/**
 * Address-bar suggestions: matching bookmarks first, then (already ranked) history
 * results, without duplicate URLs.
 */
export function mergeSuggestions(
  query: string,
  history: readonly HistoryEntry[],
  bookmarks: readonly Bookmark[],
  limit: number,
): Suggestion[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const result: Suggestion[] = bookmarks
    .map((bookmark) => ({ bookmark, score: matchScore(tokens, bookmark.url, bookmark.title) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.bookmark.createdAt - a.bookmark.createdAt)
    .slice(0, Math.min(MAX_BOOKMARK_SUGGESTIONS, limit))
    .map(({ bookmark }) => ({ kind: "bookmark", url: bookmark.url, title: bookmark.title, favicon: bookmark.favicon }));
  const seen = new Set(result.map((item) => item.url));
  for (const entry of history) {
    if (result.length >= limit) break;
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    result.push({ kind: "history", url: entry.url, title: entry.title, favicon: entry.favicon });
  }
  return result;
}
