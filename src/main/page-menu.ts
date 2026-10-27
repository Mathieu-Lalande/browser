import { Menu, clipboard, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from "electron";
import { MAX_SPLIT_TABS } from "@shared/split";
import type { TabId } from "@shared/types";
import { isPageOpenableUrl, searchUrl } from "@shared/url";
import { searchEngineOf } from "@shared/settings";
import { togglePictureInPicture } from "./media";
import { buildPageMenu, isSavableUrl, selectionAddress, type PageMenuEntry } from "./page-menu-model";
import { settings } from "./settings";
import { spaces } from "./spaces";
import { BrowserController } from "./window";

/** Isolated world of the media actions script (PiP uses 1002, cosmetic filtering 1001). */
const MEDIA_WORLD_ID = 1003;

type MediaAction = "play" | "mute" | "loop";

/**
 * Plays/pauses, mutes or loops the audio or video element under the click. Runs in an isolated
 * world (shared DOM, no page globals: ADR-003). `x`/`y` are CSS pixels of the main frame: media in
 * iframes is not reached (as for picture-in-picture, ADR-013).
 */
function mediaScript(x: number, y: number, action: MediaAction): string {
  return `((x, y, action) => {
  const inside = (el) => { const r = el.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  const hit = document.elementFromPoint(x, y);
  const media = (hit && hit.closest("video, audio")) || [...document.querySelectorAll("video, audio")].find(inside);
  if (!media) return false;
  if (action === "play") media.paused ? media.play().catch(() => {}) : media.pause();
  else if (action === "mute") media.muted = !media.muted;
  else media.loop = !media.loop;
  return true;
})(${JSON.stringify(x)}, ${JSON.stringify(y)}, ${JSON.stringify(action)})`;
}

function runMediaAction(contents: WebContents, params: ContextMenuParams, action: MediaAction): void {
  // Context menu coordinates are in DIPs of the view; the page's CSS pixels follow its zoom.
  const zoom = contents.getZoomFactor() || 1;
  void contents
    .executeJavaScriptInIsolatedWorld(MEDIA_WORLD_ID, [{ code: mediaScript(params.x / zoom, params.y / zoom, action) }], true)
    .catch(() => {});
}

/** A new tab right after `tabId` (an http(s)/about:blank URL from the page: checked again here). */
function openNextTo(c: BrowserController, tabId: TabId, url: string, activate: boolean): TabId | null {
  if (!isPageOpenableUrl(url)) return null;
  const index = c.tabs.getState().tabs.findIndex((tab) => tab.id === tabId) + 1;
  return c.tabs.create(url, { activate, index: index || undefined });
}

/** A new private window showing `url`. From a normal window, only on this explicit request. */
function openInPrivateWindow(url: string): void {
  if (!isPageOpenableUrl(url)) return;
  const window = new BrowserController(undefined, { private: true });
  const tabId = window.tabs.activeTabId;
  if (tabId) window.tabs.navigate(tabId, url);
}

/** What each entry does; `contents` is the right-clicked tab's page. */
function runEntry(id: string, c: BrowserController, tabId: TabId, contents: WebContents, params: ContextMenuParams): void {
  const engine = searchEngineOf(settings());
  if (id.startsWith("link-open-space:")) {
    if (!c.isPrivate && isPageOpenableUrl(params.linkURL)) c.spaces.openInSpace(id.slice("link-open-space:".length), params.linkURL);
    return;
  }
  if (id.startsWith("spell-") && /^spell-\d$/.test(id)) {
    const word = params.dictionarySuggestions[Number(id.slice(6))];
    if (word) contents.replaceMisspelling(word);
    return;
  }
  switch (id) {
    case "link-open-tab":
      return void openNextTo(c, tabId, params.linkURL, true);
    case "link-open-background":
      return void openNextTo(c, tabId, params.linkURL, false);
    case "link-open-split": {
      const opened = openNextTo(c, tabId, params.linkURL, false);
      if (opened) c.tabs.openSplit(opened);
      return;
    }
    case "link-open-private":
      return openInPrivateWindow(params.linkURL);
    case "link-copy":
      return void clipboard.writeText(params.linkURL);
    case "link-copy-text":
      return void clipboard.writeText(params.linkText);
    case "image-open":
      return void openNextTo(c, tabId, params.srcURL, true);
    case "image-copy":
      return contents.copyImageAt(params.x, params.y);
    case "image-copy-url":
      return void clipboard.writeText(params.srcURL);
    case "image-save":
      // The tab's own session: will-download applies the dangerous-file rules (ADR-013).
      if (isSavableUrl(params.srcURL)) contents.downloadURL(params.srcURL);
      return;
    case "media-play":
    case "media-mute":
    case "media-loop":
      return runMediaAction(contents, params, id.slice(6) as MediaAction);
    case "media-pip":
      return void togglePictureInPicture(contents);
    case "selection-copy":
    case "edit-copy":
      return contents.copy();
    case "selection-search":
      return void openNextTo(c, tabId, searchUrl(params.selectionText, engine), true);
    case "selection-open": {
      const url = selectionAddress(params.selectionText, engine);
      if (url) openNextTo(c, tabId, url, true);
      return;
    }
    case "edit-undo":
      return contents.undo();
    case "edit-redo":
      return contents.redo();
    case "edit-cut":
      return contents.cut();
    case "edit-paste":
      return contents.paste();
    case "edit-paste-plain":
      return contents.pasteAndMatchStyle();
    case "edit-select-all":
      return contents.selectAll();
    case "spell-add":
      // The dictionary is part of the profile: a private window adds nothing to it.
      if (!c.isPrivate && params.misspelledWord) contents.session.addWordToSpellCheckerDictionary(params.misspelledWord);
      return;
    case "page-back":
      return c.tabs.back(tabId);
    case "page-forward":
      return c.tabs.forward(tabId);
    case "page-reload":
      return c.tabs.reload(tabId);
    case "page-save": {
      const url = contents.getURL();
      if (isSavableUrl(url)) contents.downloadURL(url);
      return;
    }
    case "page-copy-url":
      return void clipboard.writeText(contents.getURL());
    case "page-site-info":
      if (c.tabs.activeTabId !== tabId) c.tabs.activate(tabId);
      return c.showSiteInfo(undefined, tabId);
    case "inspect":
      return contents.inspectElement(params.x, params.y);
  }
}

function toTemplate(entries: PageMenuEntry[], click: (id: string) => void): MenuItemConstructorOptions[] {
  return entries.map((entry) => {
    if ("separator" in entry) return { type: "separator" };
    const { id, label, enabled, checked, submenu } = entry;
    if (submenu) return { id, label, enabled, submenu: toTemplate(submenu, click) };
    return {
      id,
      label,
      enabled,
      ...(checked === undefined ? {} : { type: "checkbox" as const, checked }),
      click: () => click(id),
    };
  });
}

/** The native menu for a right click on a tab's page (null if the tab has no live page). */
export function buildPageContextMenu(c: BrowserController, tabId: TabId, params: ContextMenuParams): Menu | null {
  const contents = c.tabs.pageOf(tabId);
  const tab = c.tabs.getState().tabs.find((item) => item.id === tabId);
  if (!contents || !tab) return null;
  const { split } = c.tabs.getState();
  const entries = buildPageMenu(params, {
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
    isPrivate: c.isPrivate,
    // A private window has no other space (ADR-014).
    spaces: c.isPrivate ? [] : spaces.list().filter((space) => space.id !== c.spaces.activeSpaceId),
    canSplit: !(c.tabs.splitVisible && (split?.tabIds.length ?? 0) >= MAX_SPLIT_TABS),
    engine: searchEngineOf(settings()),
  });
  return Menu.buildFromTemplate(
    toTemplate(entries, (id) => {
      // The page may have gone while the menu was open.
      if (!contents.isDestroyed()) runEntry(id, c, tabId, contents, params);
    }),
  );
}

export function showPageMenu(c: BrowserController, tabId: TabId, params: ContextMenuParams): void {
  buildPageContextMenu(c, tabId, params)?.popup({ window: c.window });
}
