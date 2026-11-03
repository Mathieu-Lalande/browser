import { Channels } from "@shared/ipc";
import { isSettingsSection } from "@shared/settings";
import type { BookmarkInput } from "@shared/types";
import { profile } from "../profile";
import { resetSettingsSection, settings, updateSettings } from "../settings";
import { startImage } from "../start-image";
import { weather } from "../weather";
import { MAX_PLACE_QUERY } from "@shared/weather";
import { BrowserController } from "../window";
import { MAX_QUERY_LENGTH, MAX_RESULTS, MAX_SETTINGS_PATCH, MAX_URL_LENGTH } from "./limits";
import { arrayOf, bool, custom, defineHandlers, handle, handleUi, intIn, maxStr, nullable, on, oneOf, opt, record, str, type Guard } from "./registry";
import { clearRangeStart, HISTORY_CLEAR_RANGES, HISTORY_PAGE_SIZE, type HistoryCursor } from "@shared/history";

/** Undefined (use the default) or an integer in 1…MAX_RESULTS. */
const limit = opt(intIn(1, MAX_RESULTS));

const isBookmarkInput: Guard<BookmarkInput> = (value): value is BookmarkInput => {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Record<string, unknown>;
  const optionalString = opt(str);
  return maxStr(MAX_URL_LENGTH)(b.url) && optionalString(b.title) && (b.favicon === null || optionalString(b.favicon)) && optionalString(b.folderId);
};

const isHistoryCursor = custom<HistoryCursor>((value) => {
  if (typeof value !== "object" || value === null) return false;
  const cursor = value as Record<string, unknown>;
  return typeof cursor.lastVisit === "number" && Number.isFinite(cursor.lastVisit) && maxStr(MAX_URL_LENGTH)(cursor.url);
});

/** Saves the history when pages were removed; returns how many. */
function historyChanged(removed: number): number {
  if (removed) profile().saveHistory();
  return removed;
}

function bookmarksChanged(): void {
  profile().saveBookmarks();
  BrowserController.refreshAll();
}

/** History and bookmarks: chrome UI only (pages have no preload, and other senders are refused). */
export const historyHandlers = defineHandlers({
  [Channels.historySearch]: handleUi([maxStr(MAX_QUERY_LENGTH), limit], (text, max) => profile().history.search(text, max ?? 10, Date.now())),
  [Channels.historyTopSites]: handleUi([limit], (max) => profile().history.topSites(max ?? 8, Date.now())),
  [Channels.historyClear]: handleUi([], () => {
    profile().history.clear();
    profile().saveHistory();
  }),
  // browser://history (ADR-039): never shown nor changed from a private window.
  [Channels.historyPage]: handle(
    [maxStr(MAX_QUERY_LENGTH), nullable(isHistoryCursor)],
    (_c, query, cursor) => profile().history.page({ query, cursor, limit: HISTORY_PAGE_SIZE }),
    { privateRefused: true },
  ),
  [Channels.historyRemove]: handle(
    [arrayOf(maxStr(MAX_URL_LENGTH), HISTORY_PAGE_SIZE * 50)],
    (_c, urls) => historyChanged(profile().history.removeMany(urls)),
    { privateRefused: true },
  ),
  [Channels.historyClearRange]: handle(
    [oneOf(...HISTORY_CLEAR_RANGES)],
    (_c, range) => historyChanged(profile().history.removeSince(clearRangeStart(range, Date.now()))),
    { privateRefused: true },
  ),
  [Channels.bookmarksList]: handleUi([], () => profile().bookmarks.list()),
  [Channels.bookmarksAdd]: handleUi([isBookmarkInput], (input) => {
    const bookmark = profile().bookmarks.add(input, Date.now());
    if (bookmark) bookmarksChanged();
    return bookmark;
  }),
  [Channels.bookmarksRemove]: handleUi([str], (bookmarkId) => {
    if (profile().bookmarks.remove(bookmarkId)) bookmarksChanged();
  }),
  [Channels.bookmarksToggleActive]: on([], (c) => c.toggleBookmark()),
});

/** Settings: the patch is an untrusted object, validated field by field by `sanitizeSettings`. */
export const settingsHandlers = defineHandlers({
  [Channels.settingsGet]: handleUi([], () => settings()),
  [Channels.settingsUpdate]: handleUi([record(MAX_SETTINGS_PATCH)], (patch) => updateSettings(patch)),
  [Channels.settingsReset]: handleUi([opt(isSettingsSection)], (section) => resetSettingsSection(section)),
  [Channels.settingsOpen]: on([], (c) => c.openSettings()),
  // Only the chrome UI (where the settings page lives) captures shortcuts, never the overlay.
  [Channels.shortcutCapture]: on([bool], (c, active) => (c.capturingShortcut = active), { from: "chrome" }),
  // The URL comes from the settings, never from the renderer; private windows get nothing (ADR-018).
  [Channels.startImage]: handle([], (c) => {
    const { background, backgroundImage } = settings().startPage;
    return c.isPrivate || background !== "image" ? null : startImage(backgroundImage);
  }),
});

const coordinate = (max: number) => custom<number>((value) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= max);

/** Weather widget (ADR-034): main asks Open-Meteo; the UI only gives a search text or coordinates. */
export const weatherHandlers = defineHandlers({
  [Channels.weatherPlaces]: handleUi([maxStr(MAX_PLACE_QUERY)], (query) => weather().places(query)),
  [Channels.weatherForecast]: handleUi([coordinate(90), coordinate(180)], (latitude, longitude) => weather().forecast(latitude, longitude)),
});
