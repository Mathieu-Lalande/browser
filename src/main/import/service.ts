import { randomUUID } from "node:crypto";
import type { History } from "@shared/history";
import { parsePasswordCsv } from "@shared/import/passwords-csv";
import { folderLabel, IMPORT_ITEM_LABELS, type ImportedBookmark, type ImportItem, type ImportProgress, type ImportSource, type ImportSummary, type PasswordImportSummary } from "@shared/import/types";
import { findAccount, MAX_ENTRIES, saveCapture, type PasswordResult, type PasswordsStatus, type PasswordVault } from "@shared/passwords";
import type { SettingsPatch } from "@shared/settings";
import { SEARCH_ENGINES } from "@shared/url";
import type { Bookmarks } from "../storage/bookmarks";
import type { Favorites } from "../storage/organize";
import type { DetectedSource } from "./sources";

/** The profile stores an import writes to (`Profile`, narrowed). */
export interface ImportTarget {
  history: History;
  bookmarks: Bookmarks;
  favorites: Favorites;
  saveHistory(): void;
  saveBookmarks(): void;
  saveFavorites(): void;
}

export interface ImportDeps {
  profile(): ImportTarget;
  updateSettings(patch: SettingsPatch): unknown;
  /** The password vault (`PasswordVaultStore`). */
  passwords: { status(): PasswordsStatus; current(): PasswordVault; write(next: PasswordVault): PasswordResult };
  newPasswordId(): string;
  /** Finds the browsers installed on this computer. */
  detect(): DetectedSource[];
  /** Windows re-render (bookmark stars, favorites grid). */
  refreshAll(): void;
  now?(): number;
}

const STEP_LABELS: Record<ImportItem, string> = {
  bookmarks: "Import des favoris…",
  history: "Import de l'historique…",
  favorites: "Import de la grille des favoris…",
  searchEngine: "Lecture du moteur de recherche…",
};

/**
 * Import from other browsers (ADR-039): lists what is installed, then copies bookmarks, history,
 * favorites and the search engine of one profile into this one, without duplicates. Passwords come
 * from a CSV export (see `@shared/import/passwords-csv`). Never called for a private window (the
 * IPC table refuses it): everything here is written to the profile.
 */
export class ImportService {
  private detected = new Map<string, DetectedSource>();
  private running = false;

  constructor(private readonly deps: ImportDeps) {}

  /** Detects the browsers again (one may have been installed meanwhile). */
  sources(): ImportSource[] {
    this.detected = new Map(this.deps.detect().map((detected) => [detected.source.id, detected]));
    return [...this.detected.values()].map((detected) => detected.source);
  }

  /** Imports `items` of a profile listed by the last `sources()`. */
  run(profileId: string, items: readonly ImportItem[], onProgress: (progress: ImportProgress) => void = () => {}): ImportSummary {
    const reader = [...this.detected.values()].map((detected) => detected.readers.get(profileId)).find((found) => found !== undefined);
    if (!reader) return { ok: false, message: "Ce profil n'est plus disponible. Relancez la détection." };
    if (this.running) return { ok: false, message: "Un import est déjà en cours." };
    this.running = true;
    const summary: ImportSummary = { ok: true };
    const failed: string[] = [];
    const target = this.deps.profile();
    try {
      for (const item of items) {
        if (!reader.items.includes(item)) continue;
        onProgress({ step: item, label: STEP_LABELS[item] });
        try {
          if (item === "bookmarks") summary.bookmarks = this.importBookmarks(target, reader.bookmarks());
          else if (item === "history") {
            const visits = reader.history();
            const added = target.history.importEntries(visits);
            summary.history = { added, merged: visits.length - added };
            if (visits.length) target.saveHistory();
          } else if (item === "favorites") summary.favorites = this.importFavorites(target, reader.favorites());
          else summary.searchEngine = this.importSearchEngine(reader.searchEngine());
        } catch {
          failed.push(IMPORT_ITEM_LABELS[item].toLowerCase());
        }
      }
    } finally {
      this.running = false;
    }
    this.deps.refreshAll();
    onProgress({ step: "done", label: "Import terminé" });
    if (failed.length) return { ...summary, ok: false, message: `Illisible : ${failed.join(", ")}. Fermez l'autre navigateur puis réessayez.` };
    return summary;
  }

  /** Merges the logins of a password CSV into the vault: new accounts added, changed passwords updated. */
  importPasswordCsv(text: string): PasswordImportSummary {
    const empty = { added: 0, updated: 0, skipped: 0, invalid: 0 };
    const status = this.deps.passwords.status();
    if (!status.available) return { ok: false, message: status.message ?? "Les mots de passe ne peuvent pas être enregistrés.", ...empty };
    const parsed = parsePasswordCsv(text);
    if (parsed.error) return { ok: false, message: parsed.error, ...empty };
    const now = this.now();
    let vault = this.deps.passwords.current();
    const counts = { ...empty, invalid: parsed.invalid };
    for (const entry of parsed.entries) {
      const known = findAccount(vault, entry.origin, entry.username);
      if (known?.password === entry.password) counts.skipped++;
      else if (!known && vault.entries.length >= MAX_ENTRIES) counts.invalid++;
      else {
        vault = saveCapture(vault, entry, now, this.deps.newPasswordId());
        if (known) counts.updated++;
        else counts.added++;
      }
    }
    if (counts.added + counts.updated === 0) return { ok: true, ...counts };
    const written = this.deps.passwords.write(vault);
    return written.ok ? { ok: true, ...counts } : { ok: false, message: written.message, ...empty };
  }

  private importBookmarks(target: ImportTarget, bookmarks: readonly ImportedBookmark[]): { added: number; skipped: number } {
    const { bookmarks: store } = target;
    const now = this.now();
    const folders = new Map(store.folderList().map((folder) => [folder.name, folder.id]));
    let added = 0;
    for (const bookmark of bookmarks) {
      if (store.has(bookmark.url)) continue;
      const name = folderLabel(bookmark.folder);
      let folderId = name ? folders.get(name) : undefined;
      if (name && !folderId) {
        folderId = randomUUID();
        store.upsertFolder({ id: folderId, name, createdAt: now });
        folders.set(name, folderId);
      }
      if (store.add({ url: bookmark.url, title: bookmark.title || undefined, folderId }, bookmark.addedAt || now)) added++;
    }
    if (added) target.saveBookmarks();
    return { added, skipped: bookmarks.length - added };
  }

  private importFavorites(target: ImportTarget, favorites: readonly { url: string; title: string }[]): { added: number } {
    let added = 0;
    for (const favorite of favorites) if (!target.favorites.has(favorite.url) && target.favorites.add(favorite, this.now())) added++;
    if (added) target.saveFavorites();
    return { added };
  }

  private importSearchEngine(id: string | null): string | null {
    const engine = SEARCH_ENGINES.find((candidate) => candidate.id === id);
    if (!engine) return null;
    this.deps.updateSettings({ search: { engine: engine.id } });
    return engine.name;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}
