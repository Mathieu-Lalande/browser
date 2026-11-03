import { displayUrl } from "../../url";
import { rankBoost } from "../scorer";
import type { Provider, QueryContext, Suggestion } from "../types";
import { matchedRow, present, shortUrl } from "./util";
import { searchQueryOf } from "./web";

/** Pages: pinned favorites, bookmarks, history, other devices' tabs, archived tabs. */

const openUrls = (context: QueryContext) => new Set(context.tabs.map((tab) => tab.url));

/** The favorites grid (ADR-022): choosing one shows its tab, or opens it. */
export class FavoritesProvider implements Provider {
  readonly id = "favorites";
  readonly scope = "favorites" as const;

  query(text: string, context: QueryContext): Suggestion[] {
    if (!text && !context.scope) return [];
    return present(
      context.favorites.map((favorite) =>
        matchedRow(text, "favorites", {
          key: `favorite:${favorite.url}`,
          title: favorite.title || displayUrl(favorite.url),
          detail: shortUrl(favorite.url),
          icon: "star",
          favicon: favorite.favicon,
          verb: "Ouvrir",
          completion: favorite.url,
          action: { type: "favorite", url: favorite.url },
        }),
      ),
    );
  }
}

/** Bookmarks not already offered as an open tab or a favorite. */
export class BookmarksProvider implements Provider {
  readonly id = "bookmarks";
  readonly scope = "favorites" as const;

  query(text: string, context: QueryContext): Suggestion[] {
    if (!text && !context.scope) return [];
    const skip = new Set([...openUrls(context), ...context.favorites.map((favorite) => favorite.url)]);
    const bookmarks = [...context.bookmarks].filter((bookmark) => !skip.has(bookmark.url)).sort((a, b) => b.createdAt - a.createdAt);
    return present(
      bookmarks.map((bookmark) =>
        matchedRow(text, "bookmarks", {
          key: `bookmark:${bookmark.id}`,
          title: bookmark.title || displayUrl(bookmark.url),
          detail: shortUrl(bookmark.url),
          icon: "bookmark",
          favicon: bookmark.favicon,
          verb: "Ouvrir",
          completion: bookmark.url,
          action: { type: "open", url: bookmark.url },
        }),
      ),
    );
  }
}

/**
 * History already ranked for the text (main's `rankHistory`: match × frecency): kept in that order
 * as a boost, without pages offered elsewhere (open, bookmarked) nor search result pages (the web
 * provider turns those into search suggestions).
 */
export class HistoryProvider implements Provider {
  readonly id = "history";
  readonly scope = "history" as const;

  query(text: string, context: QueryContext): Suggestion[] {
    const skip = new Set([...openUrls(context), ...context.favorites.map((page) => page.url), ...context.bookmarks.map((page) => page.url)]);
    const entries = context.history.filter((entry) => !skip.has(entry.url) && searchQueryOf(entry.url, context.engine) === null);
    return present(
      entries.map((entry, index) =>
        matchedRow(
          text,
          "history",
          {
            key: `history:${entry.url}`,
            title: entry.title || displayUrl(entry.url),
            detail: shortUrl(entry.url),
            icon: "history",
            favicon: entry.favicon,
            verb: "Ouvrir",
            completion: entry.url,
            action: { type: "open", url: entry.url },
          },
          // Main matched it (on the bare URL, words…) even when the fuzzy matcher does not.
          { boost: rankBoost(index), keepUnmatched: true },
        ),
      ),
    );
  }
}

const RECENT_REMOTE = 6;

/** Tabs open on the user's other synced devices (ADR-019), not those already open here. */
export class RemoteTabsProvider implements Provider {
  readonly id = "remote";

  query(text: string, context: QueryContext): Suggestion[] {
    const seen = openUrls(context);
    const rows: (Suggestion | null)[] = [];
    for (const tab of context.remoteTabs) {
      if (seen.has(tab.url)) continue;
      seen.add(tab.url);
      rows.push(
        matchedRow(text, "remote", {
          key: `remote:${tab.url}`,
          title: tab.title || displayUrl(tab.url),
          detail: `${tab.device} · ${shortUrl(tab.url)}`,
          icon: "cloud",
          verb: "Ouvrir",
          completion: tab.url,
          action: { type: "open", url: tab.url },
        }),
      );
    }
    const found = present(rows);
    return text ? found : found.slice(0, RECENT_REMOTE);
  }
}

const RECENT_ARCHIVED = 4;

/** Archived tabs (ADR-022): choosing one restores it. */
/** Longest quote shown as a row title. */
const QUOTE_TITLE = 120;

/** Highlights (ADR-037), searched by quote, note and page: choosing one opens its page. */
export class AnnotationsProvider implements Provider {
  readonly id = "notes";
  readonly scope = "notes" as const;

  query(text: string, context: QueryContext): Suggestion[] {
    if (!text && !context.scope) return [];
    const rows = present(
      (context.annotations ?? []).map((item) =>
        matchedRow(
          text,
          "notes",
          {
            key: `note:${item.id}`,
            title: item.exact.length > QUOTE_TITLE ? `${item.exact.slice(0, QUOTE_TITLE - 1)}…` : item.exact,
            detail: `${item.title || shortUrl(item.url)}${item.note ? ` · ${item.note.replace(/\s+/g, " ").slice(0, 80)}` : ""}`,
            icon: "highlighter",
            verb: "Ouvrir la page",
            completion: item.url,
            action: { type: "open", url: item.url },
          },
          { keywords: [item.note, shortUrl(item.url)], keepUnmatched: !text },
        ),
      ),
    );
    return rows;
  }
}

export class ArchivedTabsProvider implements Provider {
  readonly id = "archived";

  query(text: string, context: QueryContext): Suggestion[] {
    const found = present(
      context.archived.map((entry) =>
        matchedRow(text, "archived", {
          key: `archived:${entry.id}`,
          title: entry.title || displayUrl(entry.url),
          detail: shortUrl(entry.url),
          icon: "archive",
          favicon: entry.favicon,
          verb: "Restaurer",
          completion: entry.url,
          action: { type: "archived", archiveId: entry.id, url: entry.url },
        }),
      ),
    );
    return text ? found : found.slice(0, RECENT_ARCHIVED);
  }
}
