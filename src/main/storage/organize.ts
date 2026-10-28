import { addArchived, removeArchived, sanitizeArchive, searchArchive, type ArchivedTab } from "@shared/archive";
import { storableFavicon } from "@shared/favicon";
import { addFavorite, moveFavorite, removeFavorite, sanitizeFavorites, type Favorite } from "@shared/favorites";

/** Stores of ADR-022 (favorites grid, archived tabs): lists kept in memory, saved by the profile. Pure. */

export const FAVORITES_VERSION = 1;
export const ARCHIVE_VERSION = 1;

export class Favorites {
  private items: Favorite[];

  constructor(items: Favorite[] = []) {
    this.items = items;
  }

  static parse(data: unknown): Favorite[] | null {
    return Array.isArray(data) ? sanitizeFavorites(data, storableFavicon) : null;
  }

  list(): Favorite[] {
    return this.items.map((favorite) => ({ ...favorite }));
  }

  has(url: string): boolean {
    return this.items.some((favorite) => favorite.url === url);
  }

  /** Returns whether the list changed. */
  add(input: { url: string; title?: string; favicon?: string | null }, now: number, index?: number): boolean {
    const next = addFavorite(this.items, { ...input, favicon: storableFavicon(input.favicon) }, now, index);
    return this.replace(next);
  }

  remove(url: string): boolean {
    return this.replace(removeFavorite(this.items, url));
  }

  move(url: string, index: number): boolean {
    return this.replace(moveFavorite(this.items, url, index));
  }

  /** A newer favicon seen on the favorite's page (kept on this device only). */
  setFavicon(url: string, favicon: string | null): boolean {
    const stored = storableFavicon(favicon);
    const favorite = this.items.find((candidate) => candidate.url === url);
    if (!favorite || !stored || favorite.favicon === stored) return false;
    favorite.favicon = stored;
    return true;
  }

  replace(next: Favorite[]): boolean {
    if (JSON.stringify(next) === JSON.stringify(this.items)) return false;
    this.items = next;
    return true;
  }

  toJSON(): Favorite[] {
    return this.items;
  }
}

export class Archive {
  private items: ArchivedTab[];

  constructor(items: ArchivedTab[] = []) {
    this.items = items;
  }

  static parse(data: unknown): ArchivedTab[] | null {
    return Array.isArray(data) ? sanitizeArchive(data, storableFavicon) : null;
  }

  list(query = ""): ArchivedTab[] {
    return searchArchive(this.items, query).map((entry) => ({ ...entry }));
  }

  get(id: string): ArchivedTab | undefined {
    return this.items.find((entry) => entry.id === id);
  }

  add(entries: ArchivedTab[]): void {
    this.items = addArchived(this.items, entries.map((entry) => ({ ...entry, favicon: storableFavicon(entry.favicon) })));
  }

  remove(id: string): boolean {
    const next = removeArchived(this.items, id);
    const changed = next.length !== this.items.length;
    this.items = next;
    return changed;
  }

  clear(): void {
    this.items = [];
  }

  toJSON(): ArchivedTab[] {
    return this.items;
  }
}
