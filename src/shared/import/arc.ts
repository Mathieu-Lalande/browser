import { cleanText, isImportableUrl, MAX_FOLDER_DEPTH, MAX_IMPORTED_BOOKMARKS, type ImportedBookmark, type ImportedFavorite } from "./types";

/**
 * Arc's sidebar (`StorableSidebar.json`): spaces, their pinned tabs and folders, and the favorites
 * row. Pinned tabs become bookmarks filed under "Arc / <espace> / <dossier>", favorites go to the
 * favorites grid: nothing is opened (an Arc user can have hundreds of pinned tabs).
 *
 * The file is undocumented: ids and objects alternate in `spaces` and `items` arrays, a space names
 * its pinned container in `containerIDs` (`["unpinned", id, "pinned", id]`), an item is a tab
 * (`data.tab.savedURL`) or a folder (children in `childrenIds`). Anything unexpected is skipped.
 */

export interface ArcSidebar {
  spaces: { title: string; pinned: number }[];
  bookmarks: ImportedBookmark[];
  favorites: ImportedFavorite[];
}

type Item = { id?: unknown; title?: unknown; childrenIds?: unknown; data?: { tab?: { savedURL?: unknown; savedTitle?: unknown } } };
type Space = { id?: unknown; title?: unknown; containerIDs?: unknown };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const objects = <T>(value: unknown): T[] => (Array.isArray(value) ? (value.filter(isObject) as T[]) : []);
const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);

/** The container holding spaces and items (the second one in files seen so far). */
function mainContainer(data: unknown): Record<string, unknown> | null {
  const containers = isObject(data) && isObject(data.sidebar) ? data.sidebar.containers : undefined;
  return objects<Record<string, unknown>>(containers).find((container) => Array.isArray(container.spaces) && Array.isArray(container.items)) ?? null;
}

export function parseArcSidebar(data: unknown): ArcSidebar {
  const container = mainContainer(data);
  if (!container) return { spaces: [], bookmarks: [], favorites: [] };
  const items = new Map<string, Item>();
  for (const item of objects<Item>(container.items)) if (typeof item.id === "string") items.set(item.id, item);

  const tabOf = (item: Item) => {
    const url = item.data?.tab?.savedURL;
    return isImportableUrl(url) ? { url, title: cleanText(item.title) || cleanText(item.data?.tab?.savedTitle) } : null;
  };

  const bookmarks: ImportedBookmark[] = [];
  const visited = new Set<string>();
  const walk = (id: string, path: string[]) => {
    const item = items.get(id);
    if (!item || visited.has(id) || bookmarks.length >= MAX_IMPORTED_BOOKMARKS) return;
    visited.add(id);
    const tab = tabOf(item);
    if (tab) return void bookmarks.push({ ...tab, folder: path.slice(0, MAX_FOLDER_DEPTH), addedAt: 0 });
    const name = cleanText(item.title);
    for (const child of ids(item.childrenIds)) walk(child, name ? [...path, name] : path);
  };

  const spaces: ArcSidebar["spaces"] = [];
  for (const space of objects<Space>(container.spaces)) {
    const title = cleanText(space.title) || "Espace";
    const containerIds = Array.isArray(space.containerIDs) ? space.containerIDs : [];
    const pinnedAt = containerIds.indexOf("pinned");
    const pinned = pinnedAt >= 0 ? containerIds[pinnedAt + 1] : undefined;
    const before = bookmarks.length;
    if (typeof pinned === "string") for (const child of ids(items.get(pinned)?.childrenIds)) walk(child, ["Arc", title]);
    spaces.push({ title, pinned: bookmarks.length - before });
  }

  const favorites: ImportedFavorite[] = [];
  for (const id of ids(container.topAppsContainerIDs)) {
    for (const child of ids(items.get(id)?.childrenIds)) {
      const tab = items.get(child) && tabOf(items.get(child)!);
      if (tab && !favorites.some((favorite) => favorite.url === tab.url)) favorites.push(tab);
    }
  }
  return { spaces, bookmarks, favorites };
}
