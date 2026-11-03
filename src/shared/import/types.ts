/**
 * Import from other browsers (ADR-039): what the parsers produce and what crosses IPC. Pure: the
 * main process reads the files (`src/main/import/`), these modules only interpret their content.
 */

export type BrowserKind = "chrome" | "edge" | "brave" | "vivaldi" | "opera" | "chromium" | "firefox" | "arc";

export const BROWSER_NAMES: Record<BrowserKind, string> = {
  chrome: "Google Chrome",
  edge: "Microsoft Edge",
  brave: "Brave",
  vivaldi: "Vivaldi",
  opera: "Opera",
  chromium: "Chromium",
  firefox: "Mozilla Firefox",
  arc: "Arc",
};

/** A bookmark read from another browser; `folder` is its path below the root ("Barre de favoris", "Tech"). */
export interface ImportedBookmark {
  url: string;
  title: string;
  folder: string[];
  /** Epoch ms (0 when unknown). */
  addedAt: number;
}

export interface ImportedVisit {
  url: string;
  title: string;
  visitCount: number;
  /** Epoch ms. */
  lastVisit: number;
}

/** A page of the favorites grid (Arc's favorites). */
export interface ImportedFavorite {
  url: string;
  title: string;
}

/** What can be imported from a profile (checkboxes of the wizard). */
export type ImportItem = "bookmarks" | "history" | "favorites" | "searchEngine";
export const IMPORT_ITEMS: readonly ImportItem[] = ["bookmarks", "history", "favorites", "searchEngine"];
export const isImportItem = (value: unknown): value is ImportItem => typeof value === "string" && (IMPORT_ITEMS as readonly string[]).includes(value);

export const IMPORT_ITEM_LABELS: Record<ImportItem, string> = {
  bookmarks: "Favoris (marque-pages)",
  history: "Historique",
  favorites: "Grille des favoris",
  searchEngine: "Moteur de recherche",
};

export interface ImportProfile {
  /** Opaque, valid for the detection that listed it. */
  id: string;
  name: string;
  items: ImportItem[];
}

export interface ImportSource {
  id: string;
  browser: BrowserKind;
  /** "Google Chrome", or "Google Chrome (test)". */
  name: string;
  profiles: ImportProfile[];
}

export interface ImportProgress {
  step: ImportItem | "done";
  /** French, for the wizard. */
  label: string;
}

export interface ImportSummary {
  ok: boolean;
  /** French, when something failed. */
  message?: string;
  bookmarks?: { added: number; skipped: number };
  history?: { added: number; merged: number };
  favorites?: { added: number };
  /** The engine now used for searches (its name), null when the profile's one is not offered here. */
  searchEngine?: string | null;
}

export interface PasswordImportSummary {
  ok: boolean;
  /** French: why nothing was imported (no file chosen is `ok` with zero counts and `cancelled`). */
  message?: string;
  cancelled?: boolean;
  added: number;
  updated: number;
  skipped: number;
  invalid: number;
}

export const isImportId = (value: unknown): value is string => typeof value === "string" && /^[\w.:@ -]{1,200}$/.test(value);

/** Longest bookmark title or folder name kept. */
export const MAX_IMPORT_TEXT = 2048;
/** Deepest folder path kept (deeper bookmarks are filed in their ancestor at this depth). */
export const MAX_FOLDER_DEPTH = 8;
/** At most this many bookmarks per import (larger files are cut). */
export const MAX_IMPORTED_BOOKMARKS = 20_000;

/** Only web pages are imported (no `javascript:` bookmarklets, `chrome://`, `file:`…). */
export function isImportableUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 8192) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const CONTROL = /[\u0000-\u001f\u007f]/g;

export const cleanText = (value: unknown): string => (typeof value === "string" ? value.replace(CONTROL, " ").trim().slice(0, MAX_IMPORT_TEXT) : "");

/** The flat bookmark folder name a path is filed under (our folders are one level deep). */
export const folderLabel = (path: readonly string[]): string => path.slice(0, MAX_FOLDER_DEPTH).join(" / ");
