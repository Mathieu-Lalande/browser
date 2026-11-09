import { t } from "@shared/i18n";
import { randomBytes } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dialog, type BaseWindow } from "electron";
import { sanitizeAnnotations } from "@shared/annotations/model";
import {
  BACKUP_EXTENSION,
  MAX_BACKUP_BYTES,
  MIN_PASSPHRASE,
  WrongPassphraseError,
  backupFileName,
  decodeBackup,
  encodeBackup,
  openSecret,
  summarizeBackup,
  type BackupContents,
  type BackupFile,
  type BackupMode,
  type BackupSummary,
} from "@shared/backup";
import { sanitizeBoosts } from "@shared/boosts";
import { History } from "@shared/history";
import { sanitizeVault, type PasswordVault } from "@shared/passwords";
import { sanitizeSettings, type Settings } from "@shared/settings";
import type { SpaceInfo } from "@shared/types";
import type { Profile } from "../profile";
import { Bookmarks } from "../storage/bookmarks";
import { Archive, Favorites } from "../storage/organize";
import { SESSION_VERSION, parseSession, type Session } from "../storage/session";

export type BackupResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export interface BackupDeps {
  profile(): Profile;
  profileName(): string;
  /** Replaces every setting (live: windows re-theme). */
  replaceSettings(next: Settings): void;
  vault: { current(): PasswordVault; write(next: PasswordVault): unknown };
  /** The open windows and spaces, as session.json would hold them now. */
  session(): Session;
  spaces: { list(): SpaceInfo[]; applySynced(next: readonly SpaceInfo[]): void };
  /** Offers a session on the start page ("Restaurer la session ?"). */
  offerSession(session: Session): void;
  refreshAll(): void;
  downloadsFolder(): string;
  /** Test hooks (unpackaged only): files used instead of the dialogs. */
  testExportPath?: string;
  testImportPath?: string;
}

/**
 * Profile backup (ADR-042): export to a `.browserbackup` file, import with a summary first, then
 * merge or replace. Cookies and site data are never part of it; passwords only when asked for,
 * sealed with a passphrase.
 */
export class BackupService {
  /** The file picked for import, until it is applied or another one is picked. */
  private pending: BackupFile | null = null;

  constructor(private readonly deps: BackupDeps) {}

  /** The sections of the open profile. */
  contents(): BackupContents {
    const profile = this.deps.profile();
    return {
      settings: profile.settings,
      bookmarks: profile.bookmarks.toJSON(),
      favorites: profile.favorites.toJSON(),
      history: profile.history.toJSON(),
      session: this.deps.session(),
      boosts: profile.boosts,
      annotations: profile.annotations,
      archive: profile.archive.toJSON(),
    };
  }

  /** Writes the backup where the user chooses. With `passphrase`, the passwords come along, sealed. */
  async export(window: BaseWindow, passphrase: string | null): Promise<BackupResult> {
    if (passphrase !== null && passphrase.length < MIN_PASSPHRASE) return { ok: false, message: t("backupService.passphraseMustLeastCharacters", { MIN_PASSPHRASE }) };
    const now = Date.now();
    let path = this.deps.testExportPath;
    if (!path) {
      const result = await dialog.showSaveDialog(window, {
        title: t("backupService.exportProfile"),
        defaultPath: join(this.deps.downloadsFolder(), backupFileName(this.deps.profileName(), now)),
        filters: [{ name: t("backupService.browserBackup"), extensions: [BACKUP_EXTENSION] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, message: "" };
      path = result.filePath;
    }
    const text = encodeBackup({
      contents: this.contents(),
      profileName: this.deps.profileName(),
      createdAt: now,
      passwords: passphrase === null ? undefined : { vault: this.deps.vault.current(), passphrase, rng: (length) => new Uint8Array(randomBytes(length)) },
    });
    try {
      writeFileSync(path, text, { mode: 0o600 });
      return { ok: true };
    } catch {
      return { ok: false, message: t("backupService.fileCouldntWritten") };
    }
  }

  /** Picks a backup file and summarizes it (nothing is changed yet). */
  async inspect(window: BaseWindow): Promise<BackupResult<{ summary: BackupSummary }>> {
    let path = this.deps.testImportPath;
    if (!path) {
      const result = await dialog.showOpenDialog(window, {
        title: t("backupService.importBackup"),
        properties: ["openFile"],
        filters: [{ name: t("backupService.browserBackup"), extensions: [BACKUP_EXTENSION] }],
      });
      if (result.canceled || !result.filePaths[0]) return { ok: false, message: "" };
      path = result.filePaths[0];
    }
    try {
      if (statSync(path).size > MAX_BACKUP_BYTES) return { ok: false, message: t("backupService.fileTooLarge") };
      this.pending = decodeBackup(readFileSync(path, "utf8"));
    } catch {
      this.pending = null;
    }
    if (!this.pending) return { ok: false, message: t("backupService.fileIsntBrowserBackup") };
    return { ok: true, summary: summarizeBackup(this.pending) };
  }

  /** Applies the inspected backup. Passwords need the passphrase (checked before anything changes). */
  apply(mode: BackupMode, passphrase: string | null): BackupResult {
    const file = this.pending;
    if (!file) return { ok: false, message: t("backupService.chooseFileFirst") };
    let vault: PasswordVault | null = null;
    if (file.passwords && passphrase) {
      try {
        vault = sanitizeVault(JSON.parse(openSecret(file.passwords, passphrase)));
      } catch (error) {
        return { ok: false, message: error instanceof WrongPassphraseError ? t("backupService.wrongPassphrase") : t("backupService.passwordsAreUnreadable") };
      }
    }
    this.pending = null;
    applyContents(this.deps, file.contents, mode);
    if (vault) this.deps.vault.write(mode === "replace" ? vault : mergeVaults(this.deps.vault.current(), vault));
    this.deps.refreshAll();
    return { ok: true };
  }
}

/** Passwords: the backup's accounts that are not already saved. */
function mergeVaults(current: PasswordVault, incoming: PasswordVault): PasswordVault {
  const accounts = new Set(current.entries.map((entry) => `${entry.origin}\n${entry.username}`));
  const ids = new Set(current.entries.map((entry) => entry.id));
  const added = incoming.entries.filter((entry) => !accounts.has(`${entry.origin}\n${entry.username}`) && !ids.has(entry.id));
  return { entries: [...current.entries, ...added], never: [...new Set([...current.never, ...incoming.never])] };
}

/** Each section through its own store's validation; "merge" keeps what is here and adds what is missing. */
export function applyContents(deps: Pick<BackupDeps, "profile" | "replaceSettings" | "spaces" | "offerSession">, contents: BackupContents, mode: BackupMode): void {
  const profile = deps.profile();
  const replace = mode === "replace";

  // Settings are one document: only "replace" takes the backup's.
  if (replace && contents.settings !== undefined && typeof contents.settings === "object" && contents.settings !== null) {
    deps.replaceSettings(sanitizeSettings(contents.settings));
  }

  const bookmarks = contents.bookmarks === undefined ? null : Bookmarks.parse(contents.bookmarks);
  if (bookmarks) {
    if (replace) {
      for (const bookmark of profile.bookmarks.list()) profile.bookmarks.removeByUrl(bookmark.url);
      for (const folder of profile.bookmarks.folderList()) profile.bookmarks.removeFolder(folder.id);
    }
    for (const folder of bookmarks.folders) profile.bookmarks.upsertFolder(folder);
    for (const bookmark of bookmarks.bookmarks) if (!profile.bookmarks.has(bookmark.url)) profile.bookmarks.upsertByUrl(bookmark);
    profile.saveBookmarks();
  }

  const favorites = contents.favorites === undefined ? null : Favorites.parse(contents.favorites);
  if (favorites) {
    const kept = replace ? [] : profile.favorites.list();
    profile.favorites.replace([...kept, ...favorites.filter((favorite) => !kept.some((other) => other.url === favorite.url))]);
    profile.saveFavorites();
  }

  const history = contents.history === undefined ? null : History.parse(contents.history);
  if (history) {
    if (replace) profile.history.clear();
    profile.history.upsertMany(replace ? history : history.filter((entry) => !profile.history.get(entry.url)));
    profile.saveHistory();
  }

  if (contents.boosts !== undefined) {
    const boosts = sanitizeBoosts(contents.boosts);
    const kept = replace ? [] : profile.boosts;
    profile.saveBoosts([...kept, ...boosts.filter((boost) => !kept.some((other) => other.id === boost.id))]);
  }

  const annotations = contents.annotations === undefined ? null : sanitizeAnnotations(contents.annotations);
  if (annotations) {
    const current = replace ? { highlights: [], notes: [] } : profile.annotations;
    profile.saveAnnotations({
      highlights: [...current.highlights, ...annotations.highlights.filter((item) => !current.highlights.some((other) => other.id === item.id))],
      notes: [...current.notes, ...annotations.notes.filter((item) => !current.notes.some((other) => other.url === item.url))],
    });
  }

  const archive = contents.archive === undefined ? null : Archive.parse(contents.archive);
  if (archive) {
    if (replace) profile.archive.clear();
    profile.archive.add(archive.filter((item) => !profile.archive.get(item.id)));
    profile.saveArchive();
  }

  // The backup's windows are offered on the start page, their spaces added first.
  const session = contents.session === undefined ? null : parseSession(contents.session, SESSION_VERSION);
  if (session) {
    const spaces = deps.spaces.list();
    const missing = session.spaces.filter((space) => !spaces.some((other) => other.id === space.id));
    if (missing.length) deps.spaces.applySynced([...spaces, ...missing]);
    deps.offerSession(session);
  }
}
