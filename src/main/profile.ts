import { join } from "node:path";
import { app } from "electron";
import { sanitizeSettings, type Settings } from "@shared/settings";
import { BOOKMARKS_VERSION, Bookmarks, type BookmarksData } from "./storage/bookmarks";
import { HISTORY_VERSION, History } from "./storage/history";
import { JsonFile } from "./storage/json-file";
import { SESSION_VERSION, parseSession, type Session } from "./storage/session";

/** Everything the browser persists in the user's profile directory (`userData`). */
export interface Profile {
  history: History;
  bookmarks: Bookmarks;
  /** The session saved by the previous run (null on first launch or if it was unreadable). */
  previousSession: Session | null;
  /** Current user settings (always complete and valid). */
  readonly settings: Settings;
  saveHistory(): void;
  saveBookmarks(): void;
  /** Replaces the settings and schedules their write. */
  saveSettings(next: Settings): void;
  /** Debounced: `snapshot` is taken when the write happens. */
  saveSession(snapshot: () => Session): void;
  /** Writes every pending change now (on quit). */
  flush(): void;
}

let current: Profile | null = null;

export const SETTINGS_VERSION = 1;

export function openProfile(dir = app.getPath("userData")): Profile {
  const historyFile = new JsonFile({
    path: join(dir, "history.json"),
    version: HISTORY_VERSION,
    parse: (data) => History.parse(data),
    debounceMs: 2000,
  });
  const bookmarksFile = new JsonFile<BookmarksData>({
    path: join(dir, "bookmarks.json"),
    version: BOOKMARKS_VERSION,
    parse: (data) => Bookmarks.parse(data),
    debounceMs: 300,
  });
  const sessionFile = new JsonFile<Session>({
    path: join(dir, "session.json"),
    version: SESSION_VERSION,
    parse: (data) => parseSession(data),
    debounceMs: 1000,
  });

  const settingsFile = new JsonFile<Settings>({
    path: join(dir, "settings.json"),
    version: SETTINGS_VERSION,
    // Field-level validation: a bad value falls back to its default instead of losing the file.
    parse: (data) => (typeof data === "object" && data !== null ? sanitizeSettings(data) : null),
    debounceMs: 300,
  });

  const history = new History(historyFile.load() ?? []);
  const bookmarks = new Bookmarks(bookmarksFile.load() ?? undefined);
  let settings = settingsFile.load() ?? sanitizeSettings(undefined);

  current = {
    history,
    bookmarks,
    previousSession: sessionFile.load(),
    get settings() {
      return settings;
    },
    saveHistory: () => historyFile.scheduleSave(() => history.toJSON()),
    saveBookmarks: () => bookmarksFile.scheduleSave(() => bookmarks.toJSON()),
    saveSession: (snapshot) => sessionFile.scheduleSave(snapshot),
    saveSettings: (next) => {
      settings = next;
      settingsFile.scheduleSave(() => settings);
    },
    flush: () => {
      historyFile.flush();
      bookmarksFile.flush();
      sessionFile.flush();
      settingsFile.flush();
    },
  };
  return current;
}

/** The open profile; `openProfile()` runs once at startup, before any window exists. */
export function profile(): Profile {
  if (!current) throw new Error("Profile not opened");
  return current;
}

/** Writes pending changes, if the profile was opened at all. */
export function flushProfile(): void {
  current?.flush();
}
