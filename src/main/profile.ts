import { join } from "node:path";
import { app } from "electron";
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
  saveHistory(): void;
  saveBookmarks(): void;
  /** Debounced: `snapshot` is taken when the write happens. */
  saveSession(snapshot: () => Session): void;
  /** Writes every pending change now (on quit). */
  flush(): void;
}

let current: Profile | null = null;

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

  const history = new History(historyFile.load() ?? []);
  const bookmarks = new Bookmarks(bookmarksFile.load() ?? undefined);

  current = {
    history,
    bookmarks,
    previousSession: sessionFile.load(),
    saveHistory: () => historyFile.scheduleSave(() => history.toJSON()),
    saveBookmarks: () => bookmarksFile.scheduleSave(() => bookmarks.toJSON()),
    saveSession: (snapshot) => sessionFile.scheduleSave(snapshot),
    flush: () => {
      historyFile.flush();
      bookmarksFile.flush();
      sessionFile.flush();
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
