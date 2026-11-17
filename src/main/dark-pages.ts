import { nativeTheme, webContents, type WebContents } from "electron";
import { DARK_PAGE_CSS, DARK_PAGE_PROBE, toggleDarkSite, wantsDarkPage } from "@shared/dark-pages";
import { onSettingsChanged, settings, updateSettings } from "./settings";

/**
 * Forced dark pages (ADR-059): on each new document of a tab (dom-ready, private windows too:
 * nothing is written), the page is probed in an isolated world and, when it is light and the
 * setting wants it dark, gets the inverting stylesheet (`insertCSS`, removed when the setting
 * changes: no reload; author origin, as Chromium cannot remove a user-origin sheet). Pages are found again through `webContents` by the ones seen here.
 */

const PROBE_WORLD_ID = 1023;

interface PageState {
  key: string | null;
  queue: Promise<void>;
}

const pages = new WeakMap<WebContents, PageState>();

const themeIsDark = (): boolean => {
  const mode = settings().appearance.mode;
  return mode === "dark" || (mode === "system" && nativeTheme.shouldUseDarkColors);
};

function hostOf(contents: WebContents): string {
  try {
    const url = new URL(contents.getURL());
    return url.protocol === "http:" || url.protocol === "https:" ? url.hostname : "";
  } catch {
    return "";
  }
}

/** Puts on or takes off the stylesheet, as the settings want for the page's site. */
function restyle(contents: WebContents, state: PageState): Promise<void> {
  state.queue = state.queue
    .then(async () => {
      if (contents.isDestroyed()) return;
      const { darkPages, darkPagesSites } = settings().appearance;
      const wanted = wantsDarkPage(darkPages, darkPagesSites, hostOf(contents), themeIsDark());
      if (!wanted) {
        if (state.key) await contents.removeInsertedCSS(state.key).catch(() => {});
        state.key = null;
        return;
      }
      if (state.key) return;
      const light = await contents.executeJavaScriptInIsolatedWorld(PROBE_WORLD_ID, [{ code: DARK_PAGE_PROBE }]).catch(() => false);
      if (light === true && !contents.isDestroyed()) state.key = await contents.insertCSS(DARK_PAGE_CSS);
    })
    .catch(() => {});
  return state.queue;
}

/** A new document is ready: its previous stylesheet died with the old one. */
export function darkPageReady(contents: WebContents): void {
  const state: PageState = { key: null, queue: pages.get(contents)?.queue ?? Promise.resolve() };
  pages.set(contents, state);
  void restyle(contents, state);
}

/** The setting or the theme changed: every known page follows, live. */
export function refreshDarkPages(): void {
  for (const contents of webContents.getAllWebContents()) {
    const state = pages.get(contents);
    if (state && !contents.isDestroyed()) void restyle(contents, state);
  }
}

let watching = false;

/** Starts following the settings and the system theme (once, at startup). */
export function watchDarkPages(): void {
  if (watching) return;
  watching = true;
  let last = JSON.stringify([settings().appearance.darkPages, settings().appearance.darkPagesSites, settings().appearance.mode]);
  onSettingsChanged((current) => {
    const next = JSON.stringify([current.appearance.darkPages, current.appearance.darkPagesSites, current.appearance.mode]);
    if (next === last) return;
    last = next;
    refreshDarkPages();
  });
  nativeTheme.on("updated", refreshDarkPages);
}

/** "Mode sombre pour ce site": flips the global switch for the page's site (kept in the settings). */
export function toggleDarkPageFor(url: string): void {
  let host = "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") host = parsed.hostname;
  } catch {
    return;
  }
  if (host) updateSettings({ appearance: { darkPagesSites: toggleDarkSite(settings().appearance.darkPagesSites, host) } });
}
