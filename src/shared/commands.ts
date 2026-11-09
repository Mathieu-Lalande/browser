import { t, keywords } from "./i18n";
import {
  acceleratorKeys,
  acceleratorProblem,
  acceleratorText,
  normalizeAccelerator,
  sameAccelerator,
  type AcceleratorProblem,
} from "./accelerators";
import type { TabState } from "./types";

/**
 * Registry of browser commands: one source of truth for their label, search keywords and
 * shortcut. Main builds menu items from it and runs commands (`src/main/commands.ts`); the
 * command palette lists them and asks main to run them by id.
 */

export type CommandId =
  | "new-tab"
  | "new-window"
  | "close-tab"
  | "duplicate-tab"
  | "toggle-pin"
  | "reload"
  | "back"
  | "forward"
  | "copy-url"
  | "toggle-bookmark"
  | "focus-address"
  | "toggle-sidebar"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "devtools"
  | "clear-history"
  | "command-palette"
  | "open-settings"
  | "toggle-zen"
  | "find"
  | "find-next"
  | "find-previous"
  | "open-downloads"
  | "toggle-mute"
  | "picture-in-picture"
  | "pause-all-media"
  | "toggle-split"
  | "new-space"
  | "next-space"
  | "previous-space"
  | "new-private-window"
  | "sleep-tab"
  | "sleep-other-tabs"
  | "sync-now"
  | "site-info"
  | "clear-site-data"
  | "toggle-favorite"
  | "new-folder"
  | "open-archive"
  | "open-history"
  | "import-data"
  | "open-extensions"
  | "open-passwords"
  | "toggle-reader"
  | "toggle-mobile-site"
  | "translate-page"
  | "highlight-selection"
  | "toggle-notes-panel"
  | "toggle-assistant"
  | "toggle-web-panel"
  | "add-web-panel"
  | "toggle-reading-list"
  | "open-reading-list"
  | "toggle-auto-pip"
  | "open-notes"
  | "open-boosts"
  | "open-privacy-dashboard"
  | "open-site-settings"
  | "zap-elements"
  | "check-updates"
  | "install-update"
  | "page-options"
  | "screenshot-visible"
  | "screenshot-full"
  | "screenshot-element"
  | "record-video"
  | "print"
  | "save-page"
  | "view-source"
  | "reopen-closed-tab"
  | "reopen-closed-window"
  | "open-task-manager"
  | "open-profiles"
  | "new-profile"
  | "open-autofill"
  | "select-all-tabs"
  | "toggle-compact-mode"
  | "toggle-sidebar-position"
  | "toggle-fullscreen"
  | "edit-space"
  | "app-menu"
  | "open-sync"
  | "keyboard-shortcuts"
  | "about"
  | "report-issue"
  | "open-welcome"
  | "quit";

/** Icon names used by commands; the UI's Icon component must know each of them. */
export type CommandIcon =
  | "plus"
  | "window"
  | "close"
  | "duplicate"
  | "pin"
  | "reload"
  | "back"
  | "forward"
  | "copy"
  | "star"
  | "search"
  | "sidebar"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "code"
  | "trash"
  | "command"
  | "settings"
  | "zen"
  | "download"
  | "volume"
  | "pip"
  | "pause"
  | "split"
  | "layers"
  | "mask"
  | "moon"
  | "cloud"
  | "info"
  | "cookie"
  | "favorite"
  | "folder"
  | "archive"
  | "extension"
  | "key"
  | "reader"
  | "smartphone"
  | "rocket"
  | "eraser"
  | "update"
  | "more"
  | "camera"
  | "capture-full"
  | "capture-element"
  | "video"
  | "printer"
  | "save"
  | "file-code"
  | "undo"
  | "list-checks"
  | "panel-left-close"
  | "panel-right"
  | "maximize"
  | "palette"
  | "keyboard"
  | "help"
  | "bug"
  | "log-out"
  | "send"
  | "languages"
  | "highlighter"
  | "notebook-pen"
  | "notebook"
  | "history"
  | "import"
  | "pencil"
  | "activity"
  | "users"
  | "user-plus"
  | "credit-card"
  | "library"
  | "sparkles"
  | "shield-check"
  | "sliders"
  | "sparkle"
  | "book-marked";

/** What a command's label and availability may depend on. */
export interface CommandContext {
  activeTab?: TabState;
}

export interface CommandDefinition {
  id: CommandId;
  label: string;
  /** Label when the command would undo the active tab's current state (`toggles`). */
  activeLabel?: string;
  /** Which active-tab flag `activeLabel` follows. */
  toggles?: "isPinned" | "isBookmarked" | "isMuted" | "isFavorite" | "reader" | "mobileSite" | "translated" | "inReadingList";
  /** Label in the application menu, when it differs (toggles have a neutral one). */
  menuLabel?: string;
  /** Extra search terms (synonyms, English names). */
  keywords: readonly string[];
  /** Electron accelerator, e.g. "CmdOrCtrl+Shift+C". */
  accelerator?: string;
  icon: CommandIcon;
  /** Only makes sense when the active tab shows a web page (not the start page). */
  needsPage?: boolean;
  /** Listed in the command palette (default true). */
  palette?: boolean;
  /** Destructive commands ask for confirmation in the palette first. */
  confirm?: { title: string; detail: string; action: string };
  /** Opens a popover in the overlay layer: the palette lets it take its place instead of closing the layer. */
  opensOverlay?: boolean;
}

const isMac = (platform: string) => platform === "darwin";

const DEFINITIONS: { [Id in CommandId]: Omit<CommandDefinition, "id"> } = {
  "new-tab": { get label() { return t("sharedCommands.newTab") }, get keywords() { return keywords("sharedCommands.newTabKeywords") }, accelerator: "CmdOrCtrl+T", icon: "plus" },
  "new-window": { get label() { return t("sharedCommands.newWindow") }, get keywords() { return keywords("sharedCommands.newWindowKeywords") }, accelerator: "CmdOrCtrl+N", icon: "window" },
  "close-tab": { get label() { return t("sharedCommands.closeTab") }, get keywords() { return keywords("sharedCommands.closeTabKeywords") }, accelerator: "CmdOrCtrl+W", icon: "close" },
  "duplicate-tab": {
    get label() { return t("sharedCommands.duplicateTab") },
    get keywords() { return keywords("sharedCommands.duplicateKeywords") },
    accelerator: "CmdOrCtrl+Shift+K",
    icon: "duplicate",
  },
  "toggle-pin": {
    get label() { return t("sharedCommands.pinTab") },
    get activeLabel() { return t("sharedCommands.unpinTab") },
    toggles: "isPinned",
    get menuLabel() { return t("sharedCommands.pinUnpinTab") },
    get keywords() { return keywords("sharedCommands.pinKeywords") },
    icon: "pin",
  },
  reload: { get label() { return t("sharedCommands.reload") }, get keywords() { return keywords("sharedCommands.reloadKeywords") }, accelerator: "CmdOrCtrl+R", icon: "reload", needsPage: true },
  back: { get label() { return t("sharedCommands.back") }, get keywords() { return keywords("sharedCommands.backKeywords") }, icon: "back", needsPage: true },
  forward: { get label() { return t("sharedCommands.forward") }, get keywords() { return keywords("sharedCommands.forwardKeywords") }, icon: "forward", needsPage: true },
  "copy-url": {
    get label() { return t("sharedCommands.copyUrl") },
    get keywords() { return keywords("sharedCommands.copyLinkKeywords") },
    accelerator: "CmdOrCtrl+Shift+C",
    icon: "copy",
    needsPage: true,
  },
  "toggle-bookmark": {
    get label() { return t("sharedCommands.addBookmarks") },
    get activeLabel() { return t("sharedCommands.removeFromBookmarks") },
    toggles: "isBookmarked",
    get menuLabel() { return t("sharedCommands.addRemoveBookmark") },
    get keywords() { return keywords("sharedCommands.bookmarkKeywords") },
    accelerator: "CmdOrCtrl+D",
    icon: "star",
    needsPage: true,
  },
  "focus-address": { get label() { return t("sharedCommands.addressBar") }, get keywords() { return keywords("sharedCommands.urlKeywords") }, accelerator: "CmdOrCtrl+L", icon: "search" },
  "toggle-sidebar": {
    get label() { return t("sharedCommands.showHideSidebar") },
    get menuLabel() { return t("sharedCommands.sidebar") },
    get keywords() { return keywords("sharedCommands.sidebarKeywords") },
    accelerator: "CmdOrCtrl+S",
    icon: "sidebar",
  },
  "zoom-in": { get label() { return t("sharedCommands.zoom") }, get keywords() { return keywords("sharedCommands.zoomKeywords") }, accelerator: "CmdOrCtrl+=", icon: "zoom-in" },
  "zoom-out": { get label() { return t("sharedCommands.zoomOut") }, get keywords() { return keywords("sharedCommands.zoomOutKeywords") }, accelerator: "CmdOrCtrl+-", icon: "zoom-out" },
  "zoom-reset": { get label() { return t("sharedCommands.actualSize") }, get keywords() { return keywords("sharedCommands.zoomKeywords2") }, accelerator: "CmdOrCtrl+0", icon: "zoom-reset" },
  devtools: {
    get label() { return t("sharedCommands.developerTools") },
    get keywords() { return keywords("sharedCommands.devtoolsKeywords") },
    icon: "code",
    needsPage: true,
  },
  "clear-history": {
    get label() { return t("sharedCommands.clearHistory") },
    get keywords() { return keywords("sharedCommands.clearHistoryKeywords") },
    icon: "trash",
    confirm: {
      get title() { return t("sharedCommands.clearAllHistory") },
      get detail() { return t("sharedCommands.allVisitedPagesWill") },
      get action() { return t("sharedCommands.clearHistory") },
    },
  },
  "command-palette": {
    get label() { return t("sharedCommands.universalBar") },
    get keywords() { return keywords("sharedCommands.commandPaletteKeywords") },
    accelerator: "CmdOrCtrl+K",
    icon: "command",
    palette: false,
  },
  "open-settings": {
    get label() { return t("sharedCommands.settings") },
    get menuLabel() { return t("sharedCommands.settings2") },
    get keywords() { return keywords("sharedCommands.settingsKeywords") },
    accelerator: "CmdOrCtrl+,",
    icon: "settings",
  },
  "toggle-zen": {
    get label() { return t("sharedCommands.zenMode") },
    get keywords() { return keywords("sharedCommands.zenKeywords") },
    accelerator: "CmdOrCtrl+Shift+B",
    icon: "zen",
  },
  find: {
    get label() { return t("sharedCommands.findPage") },
    get menuLabel() { return t("sharedCommands.find") },
    get keywords() { return keywords("sharedCommands.findKeywords") },
    accelerator: "CmdOrCtrl+F",
    icon: "search",
    needsPage: true,
  },
  // Follow-ups of an open find bar: in the menu (shortcuts), not in the palette.
  "find-next": { get label() { return t("sharedCommands.findNext") }, get keywords() { return keywords("sharedCommands.findNextKeywords") }, icon: "forward", needsPage: true, palette: false },
  "find-previous": { get label() { return t("sharedCommands.findPrevious") }, get keywords() { return keywords("sharedCommands.findPreviousKeywords") }, icon: "back", needsPage: true, palette: false },
  "open-downloads": {
    get label() { return t("sharedCommands.downloads") },
    get keywords() { return keywords("sharedCommands.downloadsKeywords") },
    icon: "download",
  },
  "toggle-mute": {
    get label() { return t("sharedCommands.muteTab") },
    get activeLabel() { return t("sharedCommands.unmuteTab") },
    toggles: "isMuted",
    get menuLabel() { return t("sharedCommands.muteUnmuteTab") },
    get keywords() { return keywords("sharedCommands.muteKeywords") },
    // Firefox's shortcut. Ctrl (not Cmd) on macOS too, where Cmd+M minimizes the window.
    accelerator: "Ctrl+M",
    icon: "volume",
    needsPage: true,
  },
  "picture-in-picture": {
    get label() { return t("sharedCommands.picturePicture") },
    get keywords() { return keywords("sharedCommands.picturePictureKeywords") },
    icon: "pip",
    needsPage: true,
  },
  // Media hub (ADR-035): every tab of every window, whichever is on screen.
  "pause-all-media": {
    get label() { return t("sharedCommands.pauseAllMedia") },
    get keywords() { return keywords("sharedCommands.pauseKeywords") },
    accelerator: "CmdOrCtrl+Alt+P",
    icon: "pause",
  },
  "toggle-split": {
    get label() { return t("sharedCommands.splitView") },
    get keywords() { return keywords("sharedCommands.splitKeywords") },
    accelerator: "CmdOrCtrl+Shift+\\",
    icon: "split",
  },
  "new-space": { get label() { return t("sharedCommands.newSpace") }, get keywords() { return keywords("sharedCommands.spaceKeywords") }, icon: "layers" },
  "next-space": { get label() { return t("sharedCommands.nextSpace") }, get keywords() { return keywords("sharedCommands.spaceKeywords2") }, accelerator: "CmdOrCtrl+Alt+Right", icon: "forward" },
  "previous-space": {
    get label() { return t("sharedCommands.previousSpace") },
    get keywords() { return keywords("sharedCommands.spaceKeywords3") },
    accelerator: "CmdOrCtrl+Alt+Left",
    icon: "back",
  },
  "new-private-window": {
    get label() { return t("sharedCommands.newPrivateWindow") },
    get keywords() { return keywords("sharedCommands.privateKeywords") },
    accelerator: "CmdOrCtrl+Shift+N",
    icon: "mask",
  },
  "sleep-tab": {
    get label() { return t("sharedCommands.putTabSleep") },
    get keywords() { return keywords("sharedCommands.sleepKeywords") },
    icon: "moon",
    needsPage: true,
  },
  "sleep-other-tabs": {
    get label() { return t("sharedCommands.putOtherTabsSleep") },
    get keywords() { return keywords("sharedCommands.sleepKeywords2") },
    icon: "moon",
  },
  "sync-now": {
    get label() { return t("sharedCommands.syncNow") },
    get keywords() { return keywords("sharedCommands.syncKeywords") },
    icon: "cloud",
  },
  "site-info": {
    get label() { return t("sharedCommands.siteInfo") },
    get keywords() { return keywords("sharedCommands.siteInfoKeywords") },
    icon: "info",
    needsPage: true,
    opensOverlay: true,
  },
  "clear-site-data": {
    get label() { return t("sharedCommands.clearSiteData") },
    get keywords() { return keywords("sharedCommands.cookiesKeywords") },
    icon: "cookie",
    needsPage: true,
    confirm: {
      get title() { return t("sharedCommands.clearCookiesDataSite") },
      get detail() { return t("sharedCommands.youWillSignedOut") },
      get action() { return t("sharedCommands.clearData") },
    },
  },
  "toggle-favorite": {
    get label() { return t("sharedCommands.addFavoritesAllSpaces") },
    get activeLabel() { return t("sharedCommands.removeFromFavoritesAll") },
    toggles: "isFavorite",
    get menuLabel() { return t("sharedCommands.addRemoveFavoriteAll") },
    get keywords() { return keywords("sharedCommands.favoriteKeywords") },
    icon: "favorite",
    needsPage: true,
  },
  "new-folder": {
    get label() { return t("sharedCommands.newFolder") },
    get keywords() { return keywords("sharedCommands.folderKeywords") },
    icon: "folder",
  },
  "open-archive": {
    get label() { return t("sharedCommands.archivedTabs") },
    get keywords() { return keywords("sharedCommands.archiveKeywords") },
    icon: "archive",
  },
  "open-history": {
    get label() { return t("sharedCommands.allHistory") },
    get keywords() { return keywords("sharedCommands.historyKeywords") },
    icon: "history",
  },
  "import-data": {
    get label() { return t("sharedCommands.importFromAnotherBrowser") },
    get keywords() { return keywords("sharedCommands.importKeywords") },
    icon: "import",
  },
  "open-extensions": {
    get label() { return t("sharedCommands.extensions") },
    get keywords() { return keywords("sharedCommands.extensionsKeywords") },
    icon: "extension",
  },
  "check-updates": {
    get label() { return t("sharedCommands.checkUpdates") },
    get keywords() { return keywords("sharedCommands.updateKeywords") },
    icon: "update",
  },
  "install-update": {
    get label() { return t("sharedCommands.restartUpdate") },
    get keywords() { return keywords("sharedCommands.updateKeywords2") },
    icon: "update",
    // Only offered (menu, sidebar) once an update is downloaded.
    palette: false,
  },
  "open-passwords": {
    get label() { return t("sharedCommands.passwords") },
    get keywords() { return keywords("sharedCommands.passwordsKeywords") },
    icon: "key",
  },
  "toggle-reader": {
    get label() { return t("sharedCommands.readerMode") },
    get activeLabel() { return t("sharedCommands.exitReaderMode") },
    toggles: "reader",
    get keywords() { return keywords("sharedCommands.readerKeywords") },
    accelerator: "CmdOrCtrl+Alt+R",
    icon: "reader",
    needsPage: true,
  },
  "toggle-mobile-site": {
    get label() { return t("sharedCommands.requestMobileSite") },
    get activeLabel() { return t("sharedCommands.requestDesktopSite") },
    toggles: "mobileSite",
    get menuLabel() { return t("sharedCommands.mobileVersionSite") },
    get keywords() { return keywords("sharedCommands.mobileKeywords") },
    icon: "smartphone",
    needsPage: true,
  },
  "translate-page": {
    get label() { return t("sharedCommands.translatePage") },
    get activeLabel() { return t("sharedCommands.showOriginal") },
    toggles: "translated",
    get menuLabel() { return t("sharedCommands.translatePageShowOriginal") },
    get keywords() { return keywords("sharedCommands.translateKeywords") },
    accelerator: "CmdOrCtrl+Alt+T",
    icon: "languages",
    needsPage: true,
    opensOverlay: true,
  },
  "highlight-selection": {
    get label() { return t("sharedCommands.highlightSelection") },
    get keywords() { return keywords("sharedCommands.highlightKeywords") },
    accelerator: "CmdOrCtrl+Shift+H",
    icon: "highlighter",
    needsPage: true,
  },
  "toggle-notes-panel": {
    get label() { return t("sharedCommands.pageNotes") },
    get keywords() { return keywords("sharedCommands.notesKeywords") },
    accelerator: "CmdOrCtrl+Alt+N",
    icon: "notebook-pen",
  },
  "toggle-assistant": {
    get label() { return t("sharedCommands.aiAssistant") },
    get keywords() { return keywords("sharedCommands.assistantKeywords") },
    accelerator: "CmdOrCtrl+Alt+A",
    icon: "sparkles",
  },
  // Web panels (ADR-047): the last panel opened, or the first one.
  "toggle-web-panel": {
    get label() { return t("sharedCommands.showHideWebPanel") },
    get keywords() { return keywords("sharedCommands.panelKeywords") },
    accelerator: "CmdOrCtrl+Shift+E",
    icon: "panel-right",
  },
  "add-web-panel": {
    get label() { return t("sharedCommands.addWebPanel") },
    get keywords() { return keywords("sharedCommands.panelKeywords2") },
    icon: "plus",
  },
  // Reading list (ADR-047).
  "toggle-reading-list": {
    get label() { return t("sharedCommands.readLater") },
    get activeLabel() { return t("sharedCommands.removeFromReadingList") },
    toggles: "inReadingList",
    get menuLabel() { return t("sharedCommands.addReadingList") },
    get keywords() { return keywords("sharedCommands.readLaterKeywords") },
    accelerator: "CmdOrCtrl+Shift+D",
    icon: "book-marked",
    needsPage: true,
  },
  "open-reading-list": {
    get label() { return t("sharedCommands.readingList") },
    get keywords() { return keywords("sharedCommands.readLaterKeywords2") },
    icon: "library",
  },
  "toggle-auto-pip": {
    get label() { return t("sharedCommands.automaticPicturePicture") },
    get keywords() { return keywords("sharedCommands.pipKeywords") },
    icon: "pip",
  },
  "open-notes": {
    get label() { return t("sharedCommands.allNotes") },
    get keywords() { return keywords("sharedCommands.notesKeywords2") },
    icon: "notebook",
  },
  "open-privacy-dashboard": {
    get label() { return t("sharedCommands.privacyDashboard") },
    get keywords() { return keywords("sharedCommands.privacyKeywords") },
    icon: "shield-check",
  },
  "open-site-settings": {
    get label() { return t("sharedCommands.siteSettings") },
    get keywords() { return keywords("sharedCommands.sitesKeywords") },
    icon: "sliders",
  },
  "open-boosts": {
    get label() { return t("sharedCommands.boosts") },
    get keywords() { return keywords("sharedCommands.boostsKeywords") },
    icon: "rocket",
  },
  "zap-elements": {
    get label() { return t("sharedCommands.hideElements") },
    get keywords() { return keywords("sharedCommands.zapKeywords") },
    icon: "eraser",
    needsPage: true,
  },
  // Page options and captures (ADR-031).
  "page-options": {
    get label() { return t("sharedCommands.pageOptions") },
    get keywords() { return keywords("sharedCommands.optionsKeywords") },
    accelerator: "CmdOrCtrl+Shift+O",
    icon: "more",
    needsPage: true,
    opensOverlay: true,
  },
  "screenshot-visible": {
    get label() { return t("sharedCommands.screenshotVisibleArea") },
    get keywords() { return keywords("sharedCommands.screenshotKeywords") },
    accelerator: "CmdOrCtrl+Shift+S",
    icon: "camera",
    needsPage: true,
    opensOverlay: true,
  },
  "screenshot-full": {
    get label() { return t("sharedCommands.screenshotFullPage") },
    get keywords() { return keywords("sharedCommands.screenshotKeywords2") },
    accelerator: "CmdOrCtrl+Alt+S",
    icon: "capture-full",
    needsPage: true,
    opensOverlay: true,
  },
  "screenshot-element": {
    get label() { return t("sharedCommands.screenshotElement") },
    get keywords() { return keywords("sharedCommands.screenshotKeywords3") },
    icon: "capture-element",
    needsPage: true,
  },
  "record-video": {
    get label() { return t("sharedCommands.recordVideoTab") },
    get menuLabel() { return t("sharedCommands.recordVideoStop") },
    get keywords() { return keywords("sharedCommands.recordKeywords") },
    accelerator: "CmdOrCtrl+Alt+V",
    icon: "video",
    needsPage: true,
  },
  // App menu, sidebar and page menus (ADR-033).
  print: { get label() { return t("sharedCommands.print") }, get keywords() { return keywords("sharedCommands.printKeywords") }, accelerator: "CmdOrCtrl+P", icon: "printer", needsPage: true },
  "save-page": {
    get label() { return t("sharedCommands.savePage") },
    get keywords() { return keywords("sharedCommands.savePageKeywords") },
    icon: "save",
    needsPage: true,
  },
  "view-source": {
    get label() { return t("sharedCommands.viewPageSource") },
    get keywords() { return keywords("sharedCommands.viewSourceKeywords") },
    accelerator: "CmdOrCtrl+U",
    icon: "file-code",
    needsPage: true,
  },
  "reopen-closed-tab": {
    get label() { return t("sharedCommands.reopenClosedTab") },
    get keywords() { return keywords("sharedCommands.reopenKeywords") },
    accelerator: "CmdOrCtrl+Shift+T",
    icon: "undo",
  },
  // ADR-042.
  "reopen-closed-window": {
    get label() { return t("sharedCommands.reopenClosedWindow") },
    get keywords() { return keywords("sharedCommands.reopenWindowKeywords") },
    accelerator: "CmdOrCtrl+Alt+Shift+T",
    icon: "undo",
  },
  "open-task-manager": {
    get label() { return t("sharedCommands.taskManager") },
    get keywords() { return keywords("sharedCommands.taskManagerKeywords") },
    accelerator: "Shift+Escape",
    icon: "activity",
  },
  "open-profiles": {
    get label() { return t("sharedCommands.profiles") },
    get menuLabel() { return t("sharedCommands.profilesBackup") },
    get keywords() { return keywords("sharedCommands.profileKeywords") },
    icon: "users",
  },
  "new-profile": {
    get label() { return t("sharedCommands.newProfile") },
    get menuLabel() { return t("sharedCommands.newProfile2") },
    get keywords() { return keywords("sharedCommands.newProfileKeywords") },
    icon: "user-plus",
  },
  "open-autofill": {
    get label() { return t("sharedCommands.addressesPayments") },
    get keywords() { return keywords("sharedCommands.autofillKeywords") },
    icon: "credit-card",
  },
  "select-all-tabs": {
    get label() { return t("sharedCommands.selectAllTabs") },
    get keywords() { return keywords("sharedCommands.selectAllTabsKeywords") },
    icon: "list-checks",
  },
  "toggle-compact-mode": {
    get label() { return t("sharedCommands.compactMode") },
    get keywords() { return keywords("sharedCommands.compactKeywords") },
    icon: "panel-left-close",
  },
  "toggle-sidebar-position": {
    get label() { return t("sharedCommands.switchSidebarSide") },
    get keywords() { return keywords("sharedCommands.sidebarKeywords2") },
    icon: "panel-right",
  },
  "toggle-fullscreen": { get label() { return t("sharedCommands.fullScreen") }, get keywords() { return keywords("sharedCommands.fullscreenKeywords") }, icon: "maximize" },
  "edit-space": {
    get label() { return t("sharedCommands.editSpaceTheme") },
    get keywords() { return keywords("sharedCommands.spaceKeywords4") },
    icon: "palette",
  },
  "app-menu": { get label() { return t("sharedCommands.appMenu") }, get keywords() { return keywords("sharedCommands.menuKeywords") }, icon: "more", palette: false, opensOverlay: true },
  "open-sync": {
    get label() { return t("sharedCommands.sync") },
    get menuLabel() { return t("sharedCommands.syncSettings") },
    get keywords() { return keywords("sharedCommands.syncKeywords2") },
    icon: "cloud",
  },
  "keyboard-shortcuts": {
    get label() { return t("sharedCommands.keyboardShortcuts") },
    get keywords() { return keywords("sharedCommands.shortcutsKeywords") },
    icon: "keyboard",
  },
  about: { get label() { return t("sharedCommands.aboutBrowser") }, get keywords() { return keywords("sharedCommands.aboutKeywords") }, icon: "info" },
  "report-issue": {
    get label() { return t("sharedCommands.reportProblem") },
    get keywords() { return keywords("sharedCommands.bugKeywords") },
    icon: "bug",
  },
  // ADR-043: the first-run onboarding, again.
  "open-welcome": {
    get label() { return t("sharedCommands.guidedTour") },
    get menuLabel() { return t("sharedCommands.guidedTourBrowser") },
    get keywords() { return keywords("sharedCommands.welcomeKeywords") },
    icon: "sparkle",
  },
  quit: { get label() { return t("sharedCommands.quit") }, get keywords() { return keywords("sharedCommands.quitKeywords") }, icon: "log-out" },
};

/** Every command, in palette order. */
export const COMMANDS: readonly CommandDefinition[] = (Object.keys(DEFINITIONS) as CommandId[]).map((id) => withId(id));

/**
 * The definition with its id. Its texts stay getters (copied as such, not read): they follow
 * the UI language when it changes (ADR-052).
 */
function withId(id: CommandId): CommandDefinition {
  return Object.defineProperties({ id } as CommandDefinition, Object.getOwnPropertyDescriptors(DEFINITIONS[id]));
}

export function isCommandId(value: unknown): value is CommandId {
  return typeof value === "string" && Object.hasOwn(DEFINITIONS, value);
}

export function getCommand(id: CommandId): CommandDefinition {
  return withId(id);
}

/** Accelerators that follow each platform's convention. */
const PLATFORM_ACCELERATORS: Partial<Record<CommandId, { mac: string; other: string }>> = {
  devtools: { mac: "Alt+Cmd+I", other: "Ctrl+Shift+I" },
  back: { mac: "Cmd+[", other: "Alt+Left" },
  forward: { mac: "Cmd+]", other: "Alt+Right" },
  "find-next": { mac: "Cmd+G", other: "F3" },
  "find-previous": { mac: "Cmd+Shift+G", other: "Shift+F3" },
  // Chrome's shortcuts for the downloads page.
  "open-downloads": { mac: "Alt+Cmd+L", other: "Ctrl+Shift+J" },
  // Chrome's shortcuts for the history page (Cmd+H hides the app on macOS).
  "open-history": { mac: "Cmd+Y", other: "Ctrl+H" },
  "toggle-fullscreen": { mac: "Ctrl+Cmd+F", other: "F11" },
  quit: { mac: "Cmd+Q", other: "Ctrl+Shift+Q" },
};

/** The command's accelerator on `platform` (`process.platform` values). */
export function commandAccelerator(command: CommandDefinition, platform: string): string | undefined {
  const specific = PLATFORM_ACCELERATORS[command.id];
  if (specific) return isMac(platform) ? specific.mac : specific.other;
  return command.accelerator;
}

/** Label for the current state ("Épingler l'onglet" or "Désépingler l'onglet"). */
export function commandLabel(command: CommandDefinition, context: CommandContext): string {
  return command.toggles && command.activeLabel && context.activeTab?.[command.toggles] ? command.activeLabel : command.label;
}

/** Whether the palette should offer the command right now. */
export function isCommandAvailable(command: CommandDefinition, context: CommandContext): boolean {
  if (command.palette === false) return false;
  const tab = context.activeTab;
  if (command.id === "back") return Boolean(tab?.canGoBack);
  if (command.id === "forward") return Boolean(tab?.canGoForward);
  return !command.needsPage || Boolean(tab?.url);
}

/** Keys to display for an accelerator: "CmdOrCtrl+Shift+C" → ["⇧", "⌘", "C"] or ["Ctrl", "Maj", "C"]. */
export const shortcutKeys = acceleratorKeys;

/**
 * A shortcut as shown in tooltips and hints, one convention everywhere: "Ctrl+Maj+B" (French
 * "Maj" for Shift) on Windows/Linux, "⇧⌘B" on macOS.
 */
export const shortcutText = acceleratorText;

// --- User shortcuts (ADR-028) -----------------------------------------------------------------

/** Groups of the "Raccourcis clavier" settings: every command exactly once. */
export const COMMAND_GROUPS: readonly { label: string; ids: readonly CommandId[] }[] = [
  {
    get label() { return t("sharedCommands.tabsWindows") },
    ids: [
      "new-tab",
      "new-window",
      "new-private-window",
      "close-tab",
      "duplicate-tab",
      "toggle-pin",
      "toggle-mute",
      "pause-all-media",
      "sleep-tab",
      "sleep-other-tabs",
      "new-folder",
      "toggle-split",
      "reopen-closed-tab",
      "reopen-closed-window",
      "select-all-tabs",
      "quit",
    ],
  },
  {
    get label() { return t("sharedCommands.navigation") },
    ids: ["back", "forward", "reload", "focus-address", "copy-url", "find", "find-next", "find-previous", "print", "save-page", "view-source"],
  },
  {
    get label() { return t("sharedCommands.view") },
    ids: [
      "command-palette",
      "toggle-sidebar",
      "app-menu",
      "toggle-zen",
      "toggle-compact-mode",
      "toggle-sidebar-position",
      "toggle-fullscreen",
      "toggle-reader",
      "toggle-mobile-site",
      "translate-page",
      "toggle-notes-panel",
      "toggle-assistant",
      "toggle-web-panel",
      "add-web-panel",
      "zoom-in",
      "zoom-out",
      "zoom-reset",
      "picture-in-picture",
      "toggle-auto-pip",
      "devtools",
    ],
  },
  { get label() { return t("sharedCommands.spaces") }, ids: ["new-space", "next-space", "previous-space", "edit-space"] },
  {
    get label() { return t("sharedCommands.libraryTools") },
    ids: [
      "toggle-bookmark",
      "toggle-favorite",
      "toggle-reading-list",
      "open-reading-list",
      "open-history",
      "open-archive",
      "open-downloads",
      "open-passwords",
      "open-autofill",
      "highlight-selection",
      "open-notes",
      "open-boosts",
      "open-privacy-dashboard",
      "open-site-settings",
      "zap-elements",
      "page-options",
      "screenshot-visible",
      "screenshot-full",
      "screenshot-element",
      "record-video",
      "open-extensions",
      "site-info",
      "clear-site-data",
      "clear-history",
      "import-data",
      "sync-now",
      "open-sync",
      "check-updates",
      "install-update",
      "open-settings",
      "open-profiles",
      "new-profile",
      "open-task-manager",
      "keyboard-shortcuts",
      "about",
      "report-issue",
      "open-welcome",
    ],
  },
];

/** `settings.shortcuts`: per command, an accelerator replacing the default, or null for none. */
export type ShortcutOverrides = Partial<Record<CommandId, string | null>>;

/**
 * The shortcut a command really has: the user's (possibly none), else the registry's. The menu,
 * the palette and every hint read this, never `accelerator` directly.
 */
export function effectiveAccelerator(id: CommandId, platform: string, overrides: ShortcutOverrides = {}): string | undefined {
  if (Object.hasOwn(overrides, id)) return overrides[id] ?? undefined;
  return commandAccelerator(getCommand(id), platform);
}

/** Hidden extra accelerators of a few commands (F5 reloads too), per platform. */
const ALIASES: Partial<Record<CommandId, { mac?: string[]; other?: string[] }>> = {
  reload: { mac: ["F5"], other: ["F5"] },
  // Ctrl+Plus (Shift+= on most layouts) zooms in too.
  "zoom-in": { mac: ["CmdOrCtrl+Plus"], other: ["CmdOrCtrl+Plus"] },
  // Ctrl+G / Ctrl+Shift+G, as in Chrome (macOS already uses Cmd+G as the main shortcut).
  "find-next": { other: ["CmdOrCtrl+G"] },
  "find-previous": { other: ["CmdOrCtrl+Shift+G"] },
};

/**
 * Aliases still active: none once the user chose the command's shortcut, and never one that is
 * another command's shortcut now.
 */
export function effectiveAliases(id: CommandId, platform: string, overrides: ShortcutOverrides = {}): string[] {
  if (Object.hasOwn(overrides, id)) return [];
  const aliases = ALIASES[id]?.[isMac(platform) ? "mac" : "other"] ?? [];
  return aliases.filter((alias) => !findShortcutConflict(alias, id, platform, overrides));
}

/** App shortcuts outside the registry (edition, tab and space numbers): they cannot be taken. */
export function fixedShortcuts(platform: string): { accelerator: string; label: string }[] {
  return [
    { accelerator: "CmdOrCtrl+Z", label: t("sharedCommands.undo") },
    { accelerator: isMac(platform) ? "CmdOrCtrl+Shift+Z" : "CmdOrCtrl+Y", label: t("sharedCommands.redo") },
    { accelerator: "CmdOrCtrl+X", label: t("sharedCommands.cut") },
    { accelerator: "CmdOrCtrl+C", label: t("sharedCommands.copy") },
    { accelerator: "CmdOrCtrl+V", label: t("sharedCommands.paste") },
    { accelerator: "CmdOrCtrl+A", label: t("sharedCommands.selectAll") },
    { accelerator: "Ctrl+Tab", label: t("sharedCommands.nextTab") },
    { accelerator: "Ctrl+Shift+Tab", label: t("sharedCommands.previousTab") },
    ...Array.from({ length: 9 }, (_, i) => ({ accelerator: `CmdOrCtrl+${i + 1}`, label: i === 8 ? t("sharedCommands.lastTab") : t("sharedCommands.tab", { p: i + 1 }) })),
    ...Array.from({ length: 9 }, (_, i) => ({ accelerator: `CmdOrCtrl+Alt+${i + 1}`, label: i === 8 ? t("sharedCommands.lastSpace") : t("sharedCommands.space", { p: i + 1 }) })),
  ];
}

/** The command (other than `except`) whose effective shortcut is `accelerator` on `platform`. */
export function findShortcutConflict(
  accelerator: string,
  except: CommandId | null,
  platform: string,
  overrides: ShortcutOverrides = {},
): CommandId | null {
  for (const command of COMMANDS) {
    if (command.id === except) continue;
    const current = effectiveAccelerator(command.id, platform, overrides);
    if (current && sameAccelerator(current, accelerator, platform)) return command.id;
  }
  return null;
}

export type ShortcutCheck =
  | { ok: true; accelerator: string; conflict: CommandId | null }
  | { ok: false; reason: AcceleratorProblem | "fixed"; label?: string };

/**
 * Whether `accelerator` can become `id`'s shortcut: refused when malformed, without modifier,
 * kept by the OS or by a fixed app shortcut; otherwise names the command it would take it from.
 */
export function checkShortcut(id: CommandId, accelerator: string, platform: string, overrides: ShortcutOverrides = {}): ShortcutCheck {
  const normalized = normalizeAccelerator(accelerator);
  if (!normalized) return { ok: false, reason: "invalid" };
  const problem = acceleratorProblem(normalized, platform);
  if (problem) return { ok: false, reason: problem };
  const fixed = fixedShortcuts(platform).find((entry) => sameAccelerator(entry.accelerator, normalized, platform));
  if (fixed) return { ok: false, reason: "fixed", label: fixed.label };
  return { ok: true, accelerator: normalized, conflict: findShortcutConflict(normalized, id, platform, overrides) };
}

/**
 * Overrides once `id` takes `accelerator` (null: no shortcut), the command that had it losing it.
 * A command given back its default shortcut loses its entry.
 */
export function assignShortcut(
  overrides: ShortcutOverrides,
  id: CommandId,
  accelerator: string | null,
  platform: string,
): ShortcutOverrides {
  const next: ShortcutOverrides = { ...overrides };
  if (accelerator) {
    const conflict = findShortcutConflict(accelerator, id, platform, overrides);
    if (conflict) next[conflict] = null;
  }
  const fallback = commandAccelerator(getCommand(id), platform) ?? null;
  const isDefault = accelerator === null ? fallback === null : fallback !== null && sameAccelerator(fallback, accelerator, platform);
  if (isDefault) delete next[id];
  else next[id] = accelerator;
  return next;
}

/** Overrides with `id` back to its default shortcut. */
export function resetShortcut(overrides: ShortcutOverrides, id: CommandId): ShortcutOverrides {
  const next = { ...overrides };
  delete next[id];
  return next;
}

/** The displayed shortcut of a registry command on `platform` ("" when it has none). */
export function commandShortcut(id: CommandId, platform: string, overrides: ShortcutOverrides = {}): string {
  const accelerator = effectiveAccelerator(id, platform, overrides);
  return accelerator ? shortcutText(accelerator, platform) : "";
}

/** A tooltip naming a command's shortcut: "Nouvel onglet (Ctrl+T)", or the label alone. */
export function withShortcut(label: string, id: CommandId, platform: string, overrides: ShortcutOverrides = {}): string {
  const shortcut = commandShortcut(id, platform, overrides);
  return shortcut ? `${label} (${shortcut})` : label;
}
