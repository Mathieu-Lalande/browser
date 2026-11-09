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
          label: isBookmarked(bookmarks, tab.url) ? "Retirer des favoris" : "Ajouter aux favoris",
          icon: "star",
          onPress: () => {
            actions.toggleBookmark(tab);
            haptic("success");
          },
        },
        { key: "copy", label: "Copier le lien", icon: "link", onPress: () => copy(tab.url) },
        ...(mobileSiteInfo(tab.url) ? [{ key: "site-info", label: "Infos sur le site", icon: "info" as const, onPress: () => deps.siteInfoMenu() ?? undefined }] : []),
        ...(boostHostOf(tab.url) ? [{ key: "boost", label: "Boost du site", icon: "rocket" as const, onPress: () => deps.boostMenu() ?? undefined }] : []),
        ...(deps.hasPasswords ? [{ key: "passwords", label: "Remplir le mot de passe", icon: "key" as const, onPress: () => deps.passwordsMenu() ?? undefined }] : []),
        ...deps.autofillSections.map((section) => ({
          key: `autofill-${section}`,
          label: section === "card" ? "Remplir une carte de paiement" : "Remplir une adresse",
          icon: section === "card" ? ("credit-card" as const) : ("map-pin" as const),
          onPress: () => deps.autofillMenu(section) ?? undefined,
        })),
        { key: "reader", label: "Mode lecture", icon: "reader", onPress: () => deps.openReader(tab.id) },
        ...(deps.readLater && /^https?:/i.test(tab.url)
          ? [
              {
                key: "read-later",
                label: deps.inReadingList ? "Retirer de la liste de lecture" : "Lire plus tard",
                icon: "bookMarked" as const,
                onPress: () => {
                  deps.readLater?.(tab.id);
                  haptic("success");
                },
              },
            ]
          : []),
        ...(deps.openAssistant ? [{ key: "assistant", label: "Assistant IA", icon: "sparkles" as const, onPress: deps.openAssistant }] : []),
        {
          key: "translate",
          label: deps.translated ? "Afficher l'original" : "Traduire la page",
          icon: "languages",
          onPress: deps.toggleTranslation,
        },
        {
          key: "desktop-site",
          label: deps.desktopSite ? "Version mobile" : "Version ordinateur",
          icon: deps.desktopSite ? "smartphone" : "laptop",
          onPress: () => deps.toggleDesktopSite(tab.id),
        },
        { key: "pin", label: tab.isPinned ? "Désépingler l'onglet" : "Épingler l'onglet", icon: "pin", onPress: () => actions.setPinned(tab.id, !tab.isPinned) },
        { key: "duplicate", label: "Dupliquer l'onglet", icon: "copy", onPress: () => void actions.duplicate(tab.id) },
      );
    }
    items.push(
      { key: "new", label: "Nouvel onglet", icon: "plus", onPress: () => newTab(false) },
      { key: "private", label: "Nouvel onglet privé", icon: "mask", onPress: () => newTab(true) },
      ...(isPrivate ? [] : [{ key: "reading-list", label: "Liste de lecture", icon: "bookMarked" as const, onPress: deps.openReadingList }]),
      { key: "settings", label: "Paramètres", icon: "settings", onPress: deps.openSettings },
    );
    setMenu({ title: tab?.title || (tab?.url ? displayUrl(tab.url) : "Page d'accueil"), subtitle: tab?.url ? displayUrl(tab.url) : undefined, siteUrl: tab?.url, items });
  });

  const addressMenu = useEvent(() => {
    const items: MenuItem[] = [
      {
        key: "paste",
        label: "Coller et aller",
        icon: "fill",
        onPress: () => {
          Clipboard.getStringAsync().then((text) => text.trim() && deps.submit(text), () => {});
        },
      },
    ];
    if (tab?.url) {
      items.unshift({ key: "copy", label: "Copier le lien", icon: "link", onPress: () => copy(tab.url) });
      items.push({ key: "share", label: "Partager", icon: "share", onPress: () => share(tab.url, tab.title) });
      if (mobileSiteInfo(tab.url)) items.push({ key: "site-info", label: "Infos sur le site", icon: "info", onPress: () => deps.siteInfoMenu() ?? undefined });
    }
    setMenu({ items });
  });

  const tabsMenu = useEvent(() => {
    const items: MenuItem[] = [
      { key: "new", label: "Nouvel onglet", icon: "plus", onPress: () => newTab(false) },
      { key: "private", label: "Nouvel onglet privé", icon: "mask", onPress: () => newTab(true) },
    ];
    if (tab) items.push({ key: "close", label: "Fermer cet onglet", icon: "close", destructive: true, onPress: () => actions.closeTab(tab.id) });
    setMenu({ items });
  });

  const tabMenu = useEvent((target: MobileTab): void => {
    const items: MenuItem[] = [
      { key: "pin", label: target.isPinned ? "Désépingler" : "Épingler", icon: "pin", onPress: () => actions.setPinned(target.id, !target.isPinned) },
      { key: "duplicate", label: "Dupliquer", icon: "copy", onPress: () => void actions.duplicate(target.id) },
    ];
    const destinations = model.spaces.filter((space) => space.id !== target.spaceId);
    if (!isPrivateTab(target) && destinations.length > 0) {
      items.push({
        key: "move",
        label: "Déplacer vers l'espace…",
        icon: "layers",
        onPress: () => ({
          title: "Déplacer vers",
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
        label: "Déplacer vers un dossier",
        icon: "folderInput",
        onPress: () => ({
          title: "Déplacer vers un dossier",
          items: [
            ...folders.map(
              (folder): MenuItem => ({
                key: folder.id,
                label: folder.id === target.folderId ? `${folder.name} (actuel)` : folder.name,
                icon: "folder",
                onPress: () => actions.setTabFolder(target.id, folder.id),
              }),
            ),
            { key: "new-folder", label: "Nouveau dossier", icon: "folderPlus", onPress: () => void actions.addFolder(target.spaceId, target.id) },
            ...(target.folderId ? [{ key: "no-folder", label: "Hors dossier", icon: "close" as const, onPress: () => actions.setTabFolder(target.id, null) }] : []),
          ],
        }),
      });
    }
    if (!isPrivateTab(target) && isFavoriteUrl(target.url)) {
      const favorite = favorites.some((candidate) => isFavoriteTab(candidate.url, target.url));
      items.push({
        key: "favorite",
        label: favorite ? "Retirer de la grille des favoris" : "Ajouter à la grille des favoris",
        icon: "favorite",
        onPress: () => actions.toggleFavorite(target),
      });
    }
    if (target.url) items.push({ key: "share", label: "Partager", icon: "share", onPress: () => share(target.url, target.title) });
    items.push({ key: "close", label: "Fermer l'onglet", icon: "close", destructive: true, onPress: () => actions.closeTab(target.id) });
    setMenu({ title: target.title || (target.url ? displayUrl(target.url) : "Page d'accueil"), subtitle: target.url ? displayUrl(target.url) : undefined, siteUrl: target.url, items });
  });

  const folderMenu = useEvent((folder: MobileFolder) => {
    const count = model.tabs.filter((candidate) => candidate.folderId === folder.id).length;
    setMenu({
      title: folder.name,
      subtitle: `${count} onglet${count > 1 ? "s" : ""}`,
      items: [
        { key: "rename", label: "Renommer", icon: "edit", onPress: () => deps.renameFolder(folder) },
        {
          key: "delete",
          label: "Supprimer le dossier",
          icon: "trash",
          destructive: true,
          onPress: () =>
            count === 0
              ? actions.removeFolder(folder.id, false)
              : {
                  title: `Supprimer « ${folder.name} » ?`,
                  subtitle: `Il contient ${count} onglet${count > 1 ? "s" : ""}.`,
                  items: [
                    { key: "keep", label: "Supprimer, garder les onglets", icon: "folder", onPress: () => actions.removeFolder(folder.id, false) },
                    { key: "close", label: "Supprimer et fermer les onglets", icon: "trash", destructive: true, onPress: () => actions.removeFolder(folder.id, true) },
                  ],
                },
        },
      ],
    });
  });

  const favoriteMenu = useEvent((favorite: Favorite) => {
    const items: MenuItem[] = [
      { key: "open", label: "Ouvrir", icon: "open", onPress: () => deps.openFavorite(favorite.url) },
      { key: "copy", label: "Copier le lien", icon: "link", onPress: () => copy(favorite.url) },
    ];
    // Private browsing reads the grid but never edits it.
    if (!isPrivate) items.push({ key: "remove", label: "Retirer de la grille des favoris", icon: "trash", destructive: true, onPress: () => actions.removeFavorite(favorite.url) });
    setMenu({ title: favorite.title, subtitle: displayUrl(favorite.url), siteUrl: favorite.url, items });
  });

  /** Long press on a site of the start page. */
  const siteMenu = useEvent((url: string, title: string) => {
    haptic("medium");
    const bookmark = bookmarks.find((candidate) => candidate.url === url);
    const items: MenuItem[] = [
      { key: "open", label: "Ouvrir dans un nouvel onglet", icon: "plus", onPress: () => void actions.openUrl(url) },
      { key: "copy", label: "Copier le lien", icon: "link", onPress: () => copy(url) },
    ];
    if (bookmark) items.push({ key: "remove", label: "Retirer des favoris", icon: "trash", destructive: true, onPress: () => actions.removeBookmark(bookmark.id) });
    setMenu({ title, subtitle: displayUrl(url), siteUrl: url, items });
  });

  return { pageMenu, addressMenu, tabsMenu, tabMenu, folderMenu, favoriteMenu, siteMenu };
}
