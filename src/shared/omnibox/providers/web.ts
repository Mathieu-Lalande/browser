import { fold } from "../../fuzzy";
import { displayUrl, normalizeInput, searchUrl, type SearchEngine } from "../../url";
import type { Provider, QueryContext, Suggestion } from "../types";

/** The query of a search results page of `engine` ("…?q=foo+bar" → "foo bar"), else null. */
export function searchQueryOf(url: string, engine: SearchEngine): string | null {
  const prefix = engine.template.split("%s")[0];
  if (!url.startsWith(prefix)) return null;
  const raw = url.slice(prefix.length).split(/[&#]/, 1)[0];
  try {
    const query = decodeURIComponent(raw.replace(/\+/g, " ")).trim();
    return query || null;
  } catch {
    return null;
  }
}

const PAST_SEARCHES = 3;

/**
 * The typed text itself: "Aller à …" when it is an address (shown first), "Rechercher « … »"
 * otherwise (the fallback, shown last), plus earlier searches that start with it (from history:
 * nothing is sent to the search engine while typing).
 */
export class WebProvider implements Provider {
  readonly id = "web";

  query(text: string, context: QueryContext): Suggestion[] {
    const input = text.trim();
    if (!input) return [];
    const url = normalizeInput(input, context.engine);
    if (url !== searchUrl(input, context.engine)) {
      return [
        {
          key: "go",
          section: "go",
          title: `Aller à ${displayUrl(url)}`,
          titleRanges: [],
          detail: "",
          detailRanges: [],
          score: 0,
          icon: "globe",
          verb: "Ouvrir",
          completion: input,
          action: { type: "open", url },
        },
      ];
    }
    const typed = fold(input);
    const past = new Set<string>();
    for (const entry of context.history) {
      const query = searchQueryOf(entry.url, context.engine);
      if (query && fold(query) !== typed && fold(query).startsWith(typed)) past.add(query);
      if (past.size === PAST_SEARCHES) break;
    }
    const row = (query: string, score: number, key: string): Suggestion => ({
      key,
      section: "web",
      title: `Rechercher « ${query} »`,
      // The typed part is not highlighted: the completion is what matters.
      titleRanges: query === input ? [] : [[13 + input.length, 13 + query.length]],
      detail: context.engine.name,
      detailRanges: [],
      score,
      icon: "search",
      verb: "Rechercher",
      completion: query,
      action: { type: "open", url: searchUrl(query, context.engine) },
    });
    return [row(input, 1, "search"), ...[...past].map((query, index) => row(query, 0.5 - index / 100, `search:${query}`))];
  }
}
