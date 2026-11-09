import { t } from "@shared/i18n";
import { boostHostOf } from "@shared/boosts";
import { isFavoriteTab, isFavoriteUrl, type Favorite } from "@shared/favorites";
import type { Bookmark } from "@shared/types";
import { displayUrl } from "@shared/url";
import * as Clipboard from "expo-clipboard";
import type { MenuItem, MenuSpec } from "../components/ActionSheet";
import { isBookmarked } from "../lib/bookmarks";
import { mobileSiteInfo } from "../lib/siteInfo";
import { isPrivateTab, type MobileFolder, type MobileTab, type TabsModel } from "../lib/tabs";
import type { BrowserActions } from "../state/BrowserProvider";
import type { Theme } from "../state/theme";
import { useEvent } from "./useEvent";

/** What the browser screen's sheets reach besides the actions. */
export interface BrowserMenusDeps {
  tab: MobileTab | null;
  model: TabsModel;
  bookmarks: Bookmark[];
  favorites: Favorite[];
  isPrivate: boolean;
  actions: BrowserActions;
  haptic: Theme["haptic"];
  setMenu: (menu: MenuSpec) => void;
  copy: (text: string) => void;
  share: (url: string, title?: string) => void;
  newTab: (asPrivate: boolean) => void;
  submit: (text: string) => void;
  openSettings: () => void;
  openFavorite: (url: string) => void;
  renameFolder: (folder: MobileFolder) => void;
  /** Sub-sheets of the page menu (null when they do not apply). */
  siteInfoMenu: () => MenuSpec | null;
  boostMenu: () => MenuSpec | null;
  passwordsMenu: () => MenuSpec | null;
  hasPasswords: boolean;
  /** Saved addresses / cards for the page's form (ADR-041; none in a private tab). */
  autofillMenu: (section: "address" | "card") => MenuSpec | null;
  autofillSections: readonly ("address" | "card")[];
  /** Page tools of the page menu. */
  openReader: (tabId: string) => void;
  /** "Note de la page" (ADR-050): null in a private tab or outside web pages. */
  editPageNote: (() => void) | null;
  /** "Lire plus tard" (ADR-047): null in a private tab. */
  readLater: ((tabId: string) => void) | null;
  inReadingList: boolean;
  openReadingList: () => void;
  /** The assistant sheet (ADR-044); null while the assistant is off. */
  openAssistant: (() => void) | null;
  translated: boolean;
  toggleTranslation: () => void;
  desktopSite: boolean;
  toggleDesktopSite: (tabId: string) => void;
}

/**
 * The sheets of the browser screen: the page menu, the address bar's long press, the tabs
 * button's long press, and the overview's tab, folder and favorite menus, and a start page site.
 */
export function useBrowserMenus(deps: BrowserMenusDeps) {
  const { tab, model, bookmarks, favorites, isPrivate, actions, haptic, setMenu, copy, share, newTab } = deps;

  const pageMenu = useEvent(() => {
    const items: MenuItem[] = [];
    if (tab?.url) {
      items.push(
        {
          key: "bookmark",
          label: isBookmarked(bookmarks, tab.url) ? t("mobile.useBrowserMenus.removeFromBookmarks") : t("mobile.useBrowserMenus.addBookmarks"),
          icon: "star",
          onPress: () => {
            actions.toggleBookmark(tab);
            haptic("success");
          },
        },
        { key: "copy", label: t("mobile.useBrowserMenus.copyLink"), icon: "link", onPress: () => copy(tab.url) },
        ...(mobileSiteInfo(tab.url) ? [{ key: "site-info", label: t("mobile.useBrowserMenus.siteInfo"), icon: "info" as const, onPress: () => deps.siteInfoMenu() ?? undefined }] : []),
        ...(boostHostOf(tab.url) ? [{ key: "boost", label: t("mobile.useBrowserMenus.siteBoost"), icon: "rocket" as const, onPress: () => deps.boostMenu() ?? undefined }] : []),
        ...(deps.hasPasswords ? [{ key: "passwords", label: t("mobile.useBrowserMenus.fillPassword"), icon: "key" as const, onPress: () => deps.passwordsMenu() ?? undefined }] : []),
        ...deps.autofillSections.map((section) => ({
          key: `autofill-${section}`,
          label: section === "card" ? t("mobile.useBrowserMenus.fillPaymentCard") : t("mobile.useBrowserMenus.fillAddress"),
          icon: section === "card" ? ("credit-card" as const) : ("map-pin" as const),
          onPress: () => deps.autofillMenu(section) ?? undefined,
        })),
        { key: "reader", label: t("mobile.useBrowserMenus.readerMode"), icon: "reader", onPress: () => deps.openReader(tab.id) },
        ...(deps.editPageNote ? [{ key: "page-note", label: t("mobile.useBrowserMenus.pageNote"), icon: "notebook" as const, onPress: deps.editPageNote }] : []),
        ...(deps.readLater && /^https?:/i.test(tab.url)
          ? [
              {
                key: "read-later",
                label: deps.inReadingList ? t("mobile.useBrowserMenus.removeFromReadingList") : t("mobile.useBrowserMenus.readLater"),
                icon: "bookMarked" as const,
                onPress: () => {
                  deps.readLater?.(tab.id);
                  haptic("success");
                },
              },
            ]
          : []),
        ...(deps.openAssistant ? [{ key: "assistant", label: t("mobile.useBrowserMenus.aiAssistant"), icon: "sparkles" as const, onPress: deps.openAssistant }] : []),
        {
          key: "translate",
          label: deps.translated ? t("mobile.useBrowserMenus.showOriginal") : t("mobile.useBrowserMenus.translatePage"),
          icon: "languages",
          onPress: deps.toggleTranslation,
        },
        {
          key: "desktop-site",
          label: deps.desktopSite ? t("mobile.useBrowserMenus.mobileSite") : t("mobile.useBrowserMenus.desktopSite"),
          icon: deps.desktopSite ? "smartphone" : "laptop",
          onPress: () => deps.toggleDesktopSite(tab.id),
        },
        { key: "pin", label: tab.isPinned ? t("mobile.useBrowserMenus.unpinTab") : t("mobile.useBrowserMenus.pinTab"), icon: "pin", onPress: () => actions.setPinned(tab.id, !tab.isPinned) },
        { key: "duplicate", label: t("mobile.useBrowserMenus.duplicateTab"), icon: "copy", onPress: () => void actions.duplicate(tab.id) },
      );
    }
    items.push(
      { key: "new", label: t("mobile.useBrowserMenus.newTab"), icon: "plus", onPress: () => newTab(false) },
      { key: "private", label: t("mobile.useBrowserMenus.newPrivateTab"), icon: "mask", onPress: () => newTab(true) },
      ...(isPrivate ? [] : [{ key: "reading-list", label: t("mobile.useBrowserMenus.readingList"), icon: "bookMarked" as const, onPress: deps.openReadingList }]),
      { key: "settings", label: t("mobile.useBrowserMenus.settings"), icon: "settings", onPress: deps.openSettings },
    );
    setMenu({ title: tab?.title || (tab?.url ? displayUrl(tab.url) : t("mobile.useBrowserMenus.startPage")), subtitle: tab?.url ? displayUrl(tab.url) : undefined, siteUrl: tab?.url, items });
  });

  const addressMenu = useEvent(() => {
    const items: MenuItem[] = [
      {
        key: "paste",
        label: t("mobile.useBrowserMenus.pasteGo"),
        icon: "fill",
        onPress: () => {
          Clipboard.getStringAsync().then((text) => text.trim() && deps.submit(text), () => {});
        },
      },
    ];
    if (tab?.url) {
      items.unshift({ key: "copy", label: t("mobile.useBrowserMenus.copyLink"), icon: "link", onPress: () => copy(tab.url) });
      items.push({ key: "share", label: t("mobile.useBrowserMenus.share"), icon: "share", onPress: () => share(tab.url, tab.title) });
      if (mobileSiteInfo(tab.url)) items.push({ key: "site-info", label: t("mobile.useBrowserMenus.siteInfo"), icon: "info", onPress: () => deps.siteInfoMenu() ?? undefined });
    }
    setMenu({ items });
  });

  const tabsMenu = useEvent(() => {
    const items: MenuItem[] = [
      { key: "new", label: t("mobile.useBrowserMenus.newTab"), icon: "plus", onPress: () => newTab(false) },
      { key: "private", label: t("mobile.useBrowserMenus.newPrivateTab"), icon: "mask", onPress: () => newTab(true) },
    ];
    if (tab) items.push({ key: "close", label: t("mobile.useBrowserMenus.closeTab"), icon: "close", destructive: true, onPress: () => actions.closeTab(tab.id) });
    setMenu({ items });
  });

  const tabMenu = useEvent((target: MobileTab): void => {
    const items: MenuItem[] = [
      { key: "pin", label: target.isPinned ? t("mobile.useBrowserMenus.unpin") : t("mobile.useBrowserMenus.pin"), icon: "pin", onPress: () => actions.setPinned(target.id, !target.isPinned) },
      { key: "duplicate", label: t("mobile.useBrowserMenus.duplicate"), icon: "copy", onPress: () => void actions.duplicate(target.id) },
    ];
    const destinations = model.spaces.filter((space) => space.id !== target.spaceId);
    if (!isPrivateTab(target) && destinations.length > 0) {
      items.push({
        key: "move",
        label: t("mobile.useBrowserMenus.moveSpace"),
        icon: "layers",
        onPress: () => ({
          title: t("mobile.useBrowserMenus.move"),
          items: destinations.map((space) => ({
            key: space.id,
            label: space.name,
            icon: space.icon,
            onPress: () => actions.moveToSpace(target.id, space.id),
          })),
        }),
      });
    }
    // Organisation (ADR-022): never for private tabs, whose pages are not kept.
    if (!isPrivateTab(target) && !target.isPinned) {
      const folders = model.folders.filter((folder) => folder.spaceId === target.spaceId);
      items.push({
        key: "folder",
        label: t("mobile.useBrowserMenus.moveFolder"),
        icon: "folderInput",
        onPress: () => ({
          title: t("mobile.useBrowserMenus.moveFolder"),
          items: [
            ...folders.map(
              (folder): MenuItem => ({
                key: folder.id,
                label: folder.id === target.folderId ? t("mobile.useBrowserMenus.current", { name: folder.name }) : folder.name,
                icon: "folder",
                onPress: () => actions.setTabFolder(target.id, folder.id),
              }),
            ),
            { key: "new-folder", label: t("mobile.useBrowserMenus.newFolder"), icon: "folderPlus", onPress: () => void actions.addFolder(target.spaceId, target.id) },
            ...(target.folderId ? [{ key: "no-folder", label: t("mobile.useBrowserMenus.noFolder"), icon: "close" as const, onPress: () => actions.setTabFolder(target.id, null) }] : []),
          ],
        }),
      });
    }
    if (!isPrivateTab(target) && isFavoriteUrl(target.url)) {
      const favorite = favorites.some((candidate) => isFavoriteTab(candidate.url, target.url));
      items.push({
        key: "favorite",
        label: favorite ? t("mobile.useBrowserMenus.removeFromFavoritesGrid") : t("mobile.useBrowserMenus.addFavoritesGrid"),
        icon: "favorite",
        onPress: () => actions.toggleFavorite(target),
      });
    }
    if (target.url) items.push({ key: "share", label: t("mobile.useBrowserMenus.share"), icon: "share", onPress: () => share(target.url, target.title) });
    items.push({ key: "close", label: t("mobile.useBrowserMenus.closeTab2"), icon: "close", destructive: true, onPress: () => actions.closeTab(target.id) });
    setMenu({ title: target.title || (target.url ? displayUrl(target.url) : t("mobile.useBrowserMenus.startPage")), subtitle: target.url ? displayUrl(target.url) : undefined, siteUrl: target.url, items });
  });

  const folderMenu = useEvent((folder: MobileFolder) => {
    const count = model.tabs.filter((candidate) => candidate.folderId === folder.id).length;
    setMenu({
      title: folder.name,
      subtitle: t("mobile.useBrowserMenus.tabs", { count }),
      items: [
        { key: "rename", label: t("mobile.useBrowserMenus.rename"), icon: "edit", onPress: () => deps.renameFolder(folder) },
        {
          key: "delete",
          label: t("mobile.useBrowserMenus.deleteFolder"),
          icon: "trash",
          destructive: true,
          onPress: () =>
            count === 0
              ? actions.removeFolder(folder.id, false)
              : {
                  title: t("mobile.useBrowserMenus.delete", { name: folder.name }),
                  subtitle: t("mobile.useBrowserMenus.containsTabs", { count }),
                  items: [
                    { key: "keep", label: t("mobile.useBrowserMenus.deleteKeepTabs"), icon: "folder", onPress: () => actions.removeFolder(folder.id, false) },
                    { key: "close", label: t("mobile.useBrowserMenus.deleteCloseTabs"), icon: "trash", destructive: true, onPress: () => actions.removeFolder(folder.id, true) },
                  ],
                },
        },
      ],
    });
  });

  const favoriteMenu = useEvent((favorite: Favorite) => {
    const items: MenuItem[] = [
      { key: "open", label: t("mobile.useBrowserMenus.open"), icon: "open", onPress: () => deps.openFavorite(favorite.url) },
      { key: "copy", label: t("mobile.useBrowserMenus.copyLink"), icon: "link", onPress: () => copy(favorite.url) },
    ];
    // Private browsing reads the grid but never edits it.
    if (!isPrivate) items.push({ key: "remove", label: t("mobile.useBrowserMenus.removeFromFavoritesGrid"), icon: "trash", destructive: true, onPress: () => actions.removeFavorite(favorite.url) });
    setMenu({ title: favorite.title, subtitle: displayUrl(favorite.url), siteUrl: favorite.url, items });
  });

  /** Long press on a site of the start page. */
  const siteMenu = useEvent((url: string, title: string) => {
    haptic("medium");
    const bookmark = bookmarks.find((candidate) => candidate.url === url);
    const items: MenuItem[] = [
      { key: "open", label: t("mobile.useBrowserMenus.openNewTab"), icon: "plus", onPress: () => void actions.openUrl(url) },
      { key: "copy", label: t("mobile.useBrowserMenus.copyLink"), icon: "link", onPress: () => copy(url) },
    ];
    if (bookmark) items.push({ key: "remove", label: t("mobile.useBrowserMenus.removeFromBookmarks"), icon: "trash", destructive: true, onPress: () => actions.removeBookmark(bookmark.id) });
    setMenu({ title, subtitle: displayUrl(url), siteUrl: url, items });
  });

  return { pageMenu, addressMenu, tabsMenu, tabMenu, folderMenu, favoriteMenu, siteMenu };
}
