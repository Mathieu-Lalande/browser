import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArcSidebar } from "@shared/import/arc";
import { chromiumSearchEngine, chromiumTime, parseChromiumBookmarks } from "@shared/import/chromium";
import { FIREFOX_ROOTS, firefoxTime } from "@shared/import/firefox";
import { cleanText, isImportableUrl, MAX_FOLDER_DEPTH, type ImportedBookmark, type ImportedFavorite, type ImportedVisit, type ImportItem } from "@shared/import/types";
import { MAX_HISTORY_ENTRIES } from "@shared/history";
import { withSqliteCopy } from "./sqlite";

/**
 * What a detected profile can give. Each method reads its files when called (never at detection),
 * and throws on unreadable data: the service reports it per item.
 */
export interface ProfileReader {
  /** What this profile has (files present). */
  readonly items: ImportItem[];
  bookmarks(): ImportedBookmark[];
  history(): ImportedVisit[];
  favorites(): ImportedFavorite[];
  /** Our search engine id matching the profile's default one, null when none matches. */
  searchEngine(): string | null;
}

/** Largest JSON file read (a Chromium `Bookmarks` of 20 000 entries is a few MB). */
const MAX_JSON_BYTES = 64 * 1024 * 1024;

function readJson(file: string): unknown {
  if (statSync(file).size > MAX_JSON_BYTES) throw new Error("file too large");
  return JSON.parse(readFileSync(file, "utf8"));
}

const visit = (url: unknown, title: unknown, visitCount: unknown, lastVisit: number): ImportedVisit | null =>
  isImportableUrl(url) && lastVisit > 0 ? { url, title: cleanText(title), visitCount: Math.max(1, Number(visitCount) || 1), lastVisit } : null;

const present = <T>(values: (T | null)[]): T[] => values.filter((value): value is T => value !== null);

/** A Chromium family profile folder (`Default`, `Profile 1`, or Opera's whole folder). */
export class ChromiumProfileReader implements ProfileReader {
  readonly items: ImportItem[];

  constructor(private readonly dir: string) {
    this.items = [];
    if (existsSync(join(dir, "Bookmarks"))) this.items.push("bookmarks");
    if (existsSync(join(dir, "History"))) this.items.push("history");
    if (existsSync(join(dir, "Preferences"))) this.items.push("searchEngine");
  }

  static isProfile(dir: string): boolean {
    return existsSync(join(dir, "Bookmarks")) || existsSync(join(dir, "History"));
  }

  bookmarks(): ImportedBookmark[] {
    return parseChromiumBookmarks(readJson(join(this.dir, "Bookmarks")));
  }

  history(): ImportedVisit[] {
    return withSqliteCopy(join(this.dir, "History"), (db) => {
      const statement = db.prepare("SELECT url, title, visit_count, last_visit_time FROM urls WHERE hidden = 0 AND last_visit_time > 0 ORDER BY last_visit_time DESC LIMIT ?");
      // Chromium times (µs since 1601) are past Number.MAX_SAFE_INTEGER.
      statement.setReadBigInts(true);
      const rows = statement.all(MAX_HISTORY_ENTRIES) as { url: unknown; title: unknown; visit_count: unknown; last_visit_time: unknown }[];
      return present(rows.map((row) => visit(row.url, row.title, row.visit_count, chromiumTime(row.last_visit_time))));
    });
  }

  favorites(): ImportedFavorite[] {
    return [];
  }

  searchEngine(): string | null {
    return chromiumSearchEngine(readJson(join(this.dir, "Preferences")));
  }
}

/** A Firefox profile folder (`places.sqlite`). */
export class FirefoxProfileReader implements ProfileReader {
  readonly items: ImportItem[];

  constructor(private readonly dir: string) {
    this.items = existsSync(join(dir, "places.sqlite")) ? ["bookmarks", "history"] : [];
  }

  bookmarks(): ImportedBookmark[] {
    return withSqliteCopy(join(this.dir, "places.sqlite"), (db) => {
      type Row = { id: number; type: number; parent: number; title: unknown; guid: unknown; url: unknown; dateAdded: unknown };
      const rows = db
        .prepare("SELECT b.id AS id, b.type AS type, b.parent AS parent, b.title AS title, b.guid AS guid, p.url AS url, b.dateAdded AS dateAdded FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position")
        .all() as Row[];
      const byId = new Map(rows.map((row) => [row.id, row]));
      // A folder's path from its root (null: under the tags root, or no known root).
      const paths = new Map<number, string[] | null>();
      const pathOf = (id: number, depth = 0): string[] | null => {
        if (paths.has(id)) return paths.get(id)!;
        const folder = byId.get(id);
        let path: string[] | null = null;
        if (folder && depth < 64) {
          const root = typeof folder.guid === "string" && Object.hasOwn(FIREFOX_ROOTS, folder.guid) ? FIREFOX_ROOTS[folder.guid] : undefined;
          if (root !== undefined) path = root === null ? null : [root];
          else {
            const parent = folder.parent && folder.parent !== id ? pathOf(folder.parent, depth + 1) : null;
            const name = cleanText(folder.title);
            path = parent && (name ? [...parent, name] : parent);
          }
        }
        paths.set(id, path);
        return path;
      };
      const bookmarks: ImportedBookmark[] = [];
      for (const row of rows) {
        if (row.type !== 1 || !isImportableUrl(row.url)) continue;
        const folder = pathOf(row.parent);
        if (folder) bookmarks.push({ url: row.url, title: cleanText(row.title), folder: folder.slice(0, MAX_FOLDER_DEPTH), addedAt: firefoxTime(row.dateAdded) });
      }
      return bookmarks;
    });
  }

  history(): ImportedVisit[] {
    return withSqliteCopy(join(this.dir, "places.sqlite"), (db) => {
      const rows = db
        .prepare("SELECT url, title, visit_count, last_visit_date FROM moz_places WHERE hidden = 0 AND last_visit_date IS NOT NULL ORDER BY last_visit_date DESC LIMIT ?")
        .all(MAX_HISTORY_ENTRIES) as { url: unknown; title: unknown; visit_count: unknown; last_visit_date: unknown }[];
      return present(rows.map((row) => visit(row.url, row.title, row.visit_count, firefoxTime(row.last_visit_date))));
    });
  }

  favorites(): ImportedFavorite[] {
    return [];
  }

  searchEngine(): string | null {
    // `search.json.mozlz4` is LZ4-compressed with a Mozilla header: not worth a decoder here.
    return null;
  }
}

/** Arc's sidebar file: pinned tabs (as bookmarks) and the favorites row. */
export class ArcReader implements ProfileReader {
  readonly items: ImportItem[] = ["bookmarks", "favorites"];

  constructor(private readonly file: string) {}

  bookmarks(): ImportedBookmark[] {
    return parseArcSidebar(readJson(this.file)).bookmarks;
  }

  history(): ImportedVisit[] {
    return [];
  }

  favorites(): ImportedFavorite[] {
    return parseArcSidebar(readJson(this.file)).favorites;
  }

  searchEngine(): string | null {
    return null;
  }
}
