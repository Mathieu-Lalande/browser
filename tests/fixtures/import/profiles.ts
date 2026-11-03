import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

/**
 * Tiny browser profiles for the import tests (unit and e2e): the JSON files are checked in next to
 * this module, the SQLite databases are written here (a few rows with the real schemas' columns).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE = (name: string) => join(HERE, name);

const chromiumTime = (ms: number) => BigInt(ms) * 1000n + 11_644_473_600_000_000n;

/** A Chromium "User Data" folder with one profile ("Default", named "Personnel"): Bookmarks, History, Preferences. */
export function makeChromiumUserData(root: string, now = Date.now()): string {
  const profile = join(root, "Default");
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(root, "Local State"), JSON.stringify({ profile: { info_cache: { Default: { name: "Personnel" } } } }));
  copyFileSync(FIXTURE("Bookmarks"), join(profile, "Bookmarks"));
  writeFileSync(
    join(profile, "Preferences"),
    JSON.stringify({ default_search_provider_data: { template_url_data: { url: "https://search.brave.com/search?q={searchTerms}", keyword: "brave" } } }),
  );
  const db = new DatabaseSync(join(profile, "History"));
  db.exec("CREATE TABLE urls (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0, typed_count INTEGER DEFAULT 0, last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0)");
  const insert = db.prepare("INSERT INTO urls (url, title, visit_count, last_visit_time, hidden) VALUES (?, ?, ?, ?, ?)");
  insert.run("https://news.example.com/", "Actualités importées", 5, chromiumTime(now - 3_600_000), 0);
  insert.run("https://example.com/", "Exemple", 2, chromiumTime(now - 86_400_000), 0);
  insert.run("https://hidden.example.com/", "Caché", 1, chromiumTime(now), 1);
  insert.run("chrome://settings/", "Paramètres", 1, chromiumTime(now), 0);
  db.close();
  return root;
}

/** A Firefox folder (`profiles.ini`) with one profile holding `places.sqlite`. */
export function makeFirefoxRoot(root: string, now = Date.now()): string {
  const profile = join(root, "Profiles", "abc.default-release");
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(root, "profiles.ini"), "[General]\nStartWithLastProfile=1\n\n[Profile0]\nName=default-release\nIsRelative=1\nPath=Profiles/abc.default-release\nDefault=1\n");
  const db = new DatabaseSync(join(profile, "places.sqlite"));
  db.exec(`
    CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0 NOT NULL, last_visit_date INTEGER);
    CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER DEFAULT NULL, parent INTEGER, position INTEGER, title LONGVARCHAR, dateAdded INTEGER, guid TEXT);
  `);
  const place = db.prepare("INSERT INTO moz_places (id, url, title, visit_count, hidden, last_visit_date) VALUES (?, ?, ?, ?, ?, ?)");
  place.run(1, "https://mozilla.org/", "Mozilla", 3, 0, (now - 7_200_000) * 1000);
  place.run(2, "https://example.org/tagged", "Tagged", 1, 0, null);
  place.run(3, "https://never.example/", "Jamais visité", 0, 0, null);
  const mark = db.prepare("INSERT INTO moz_bookmarks (id, type, fk, parent, position, title, dateAdded, guid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  mark.run(1, 2, null, 0, 0, "", 0, "root________");
  mark.run(2, 2, null, 1, 0, "toolbar", 0, "toolbar_____");
  mark.run(3, 2, null, 1, 1, "tags", 0, "tags________");
  mark.run(4, 2, null, 2, 0, "Lectures", 0, "folder000001");
  mark.run(5, 1, 1, 4, 0, "Mozilla", now * 1000, "bm0000000001");
  mark.run(6, 2, null, 3, 0, "un-tag", 0, "tagfolder001");
  mark.run(7, 1, 2, 6, 0, null, now * 1000, "bm0000000002");
  mark.run(8, 1, 3, 2, 1, "Jamais", now * 1000, "bm0000000003");
  db.close();
  return root;
}
