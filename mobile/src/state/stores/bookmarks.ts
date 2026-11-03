import { addFavorite, isFavoriteTab, removeFavorite, sanitizeFavorites, type Favorite } from "@shared/favorites";
import type { Bookmark } from "@shared/types";
import { parseBookmarks, parseFolders, toggleBookmark } from "../../lib/bookmarks";
import type { BookmarkFolder } from "../../lib/sync/adapters";
import { Store } from "../store";

export interface BookmarksState {
  bookmarks: Bookmark[];
  /** Bookmark folders received from the desktop through sync (not shown on the phone). */
  folders: BookmarkFolder[];
  /** The favorites grid (ADR-022). */
  favorites: Favorite[];
}

/** Bookmarks, their synced folders, and the favorites grid. */
export class BookmarksStore extends Store<BookmarksState> {
  constructor() {
    super({ bookmarks: [], folders: [], favorites: [] });
  }

  get bookmarks(): Bookmark[] {
    return this.get().bookmarks;
  }
  get folders(): BookmarkFolder[] {
    return this.get().folders;
  }
  get favorites(): Favorite[] {
    return this.get().favorites;
  }

  hydrate(stored: { bookmarks: unknown; folders: unknown; favorites: unknown }): void {
    this.set({ bookmarks: parseBookmarks(stored.bookmarks), folders: parseFolders(stored.folders), favorites: sanitizeFavorites(stored.favorites) });
  }

  /** Bookmarks and folders as the sync engine merged them. */
  setBookmarks(bookmarks: Bookmark[], folders: BookmarkFolder[]): void {
    this.set((state) => ({ ...state, bookmarks, folders }));
  }

  setFavorites(favorites: Favorite[]): void {
    this.set((state) => ({ ...state, favorites }));
  }

  toggle(page: { url: string; title: string }, id: string, now: number): void {
    this.set((state) => ({ ...state, bookmarks: toggleBookmark(state.bookmarks, page, id, now) }));
  }

  remove(id: string): void {
    this.set((state) => ({ ...state, bookmarks: state.bookmarks.filter((bookmark) => bookmark.id !== id) }));
  }

  /** "Effacer toutes les données": the bookmarks go (the synced folders and favorites stay). */
  clearBookmarks(): void {
    this.set((state) => ({ ...state, bookmarks: [] }));
  }

  /** Adds the page to the favorites grid, or removes it (with any favorite of the same page). */
  toggleFavorite(page: { url: string; title: string }, now: number): void {
    this.set((state) => {
      const matching = state.favorites.filter((favorite) => isFavoriteTab(favorite.url, page.url));
      const favorites = matching.length ? state.favorites.filter((favorite) => !matching.includes(favorite)) : addFavorite(state.favorites, { url: page.url, title: page.title }, now);
      return { ...state, favorites };
    });
  }

  removeFavorite(url: string): void {
    this.set((state) => ({ ...state, favorites: removeFavorite(state.favorites, url) }));
  }
}
