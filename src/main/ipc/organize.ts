import { isArchiveId } from "@shared/archive";
import { isFavoriteUrl } from "@shared/favorites";
import { isFolderId, isFolderInput } from "@shared/folders";
import { Channels } from "@shared/ipc";
import { isSpaceId, isSpaceInput } from "@shared/spaces";
import {
  addFavoriteFromTab,
  clearArchive,
  moveFavorite,
  openFavorite,
  removeArchived,
  removeFavorite,
  restoreArchived,
  showFavoriteMenu,
} from "../organize";
import { profile } from "../profile";
import { spaces } from "../spaces";
import { MAX_INDEX, MAX_QUERY_LENGTH } from "./limits";
import { arrayOf, bool, defineHandlers, handle, handleUi, intIn, maxStr, nullable, on, opt, str } from "./registry";

const index = intIn(0, MAX_INDEX);

/**
 * Folders (ADR-022): per space, in the TabManager of the space shown (private windows included:
 * their tabs and folders are never saved).
 */
export const folderHandlers = defineHandlers({
  [Channels.tabPlace]: on([str, nullable(isFolderId), nullable(str)], (c, tabId, folderId, beforeId) => c.tabs.placeTab(tabId, folderId, beforeId)),
  [Channels.folderCreate]: on([opt(isFolderInput), opt(nullable(isFolderId)), opt(arrayOf(str, 100))], (c, input, parentId, tabIds) =>
    c.tabs.createFolder(input, parentId ?? null, tabIds ?? []),
  ),
  [Channels.folderUpdate]: on([isFolderId, isFolderInput], (c, folderId, input) => c.tabs.updateFolder(folderId, input)),
  [Channels.folderRemove]: on([isFolderId, bool], (c, folderId, closeTabs) => c.tabs.removeFolder(folderId, closeTabs)),
  [Channels.folderMove]: on([isFolderId, nullable(isFolderId), index], (c, folderId, parentId, at) => c.tabs.moveFolder(folderId, parentId, at)),
});

/**
 * Favorites (ADR-022): the UI names a tab of its window (main reads its URL) or a favorite by
 * URL; a private window only reads and opens them (checked in ../organize).
 */
export const favoriteHandlers = defineHandlers({
  [Channels.favoritesAdd]: on([str, opt(index)], (c, tabId, at) => addFavoriteFromTab(c, tabId, at)),
  [Channels.favoritesRemove]: on([isFavoriteUrl], (c, url) => removeFavorite(c, url)),
  [Channels.favoritesMove]: on([isFavoriteUrl, index], (c, url, at) => moveFavorite(c, url, at)),
  [Channels.favoritesOpen]: on([isFavoriteUrl], (c, url) => openFavorite(c, url)),
  [Channels.favoritesContextMenu]: on([isFavoriteUrl], (c, url) => showFavoriteMenu(c, url)),
});

/** Archived tabs (ADR-022). */
export const archiveHandlers = defineHandlers({
  [Channels.archiveList]: handleUi([opt(maxStr(MAX_QUERY_LENGTH))], (query) => profile().archive.list(query ?? "")),
  [Channels.archiveRestore]: on([isArchiveId], (c, archiveId) => restoreArchived(c, archiveId)),
  [Channels.archiveRemove]: on([isArchiveId], (c, archiveId) => removeArchived(c, archiveId)),
  [Channels.archiveClear]: on([], (c) => clearArchive(c)),
});

/**
 * Spaces are shared by every window; the one that creates a space shows it. A private window
 * only has its own ephemeral space: it cannot see nor edit the shared ones (ADR-014).
 */
export const spaceHandlers = defineHandlers({
  [Channels.spaceCreate]: handle(
    [opt(isSpaceInput)],
    (c, input) => {
      const space = spaces.create(input);
      if (space) c.spaces.switchTo(space.id);
      return space;
    },
    { privateRefused: true },
  ),
  [Channels.spaceUpdate]: on([isSpaceId, isSpaceInput], (c, spaceId, input) => {
    if (!c.isPrivate) spaces.update(spaceId, input);
  }),
  [Channels.spaceRemove]: on([isSpaceId], (c, spaceId) => {
    if (!c.isPrivate) spaces.remove(spaceId);
  }),
  [Channels.spaceSwitch]: on([isSpaceId], (c, spaceId) => c.spaces.switchTo(spaceId)),
});
