import { t } from "@shared/i18n";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, linkSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { publicEntry, resumePlan, resumeStateOf, sameResumeState, type ResumeSource } from "@shared/download-resume";
import { basename, dirname, join } from "node:path";
import { dialog, shell, type BaseWindow, type DownloadItem, type Session, type WebContents } from "electron";
import { canOpenFile, isOpenable, type DownloadEntry, type DownloadsChange } from "@shared/downloads";
import { Emitter } from "@shared/emitter";
import type { Settings, SettingsPatch } from "@shared/settings";
import type { SessionOptions, SessionService } from "../services";
import { isDangerousFile, sanitizeFilename, uniqueFilename } from "./files";
import { applySnapshot, type DownloadList, type DownloadViewer, type ItemSnapshot } from "./list";

/** Progress pushes are coalesced to this rate; state changes go out at once. */
const PUSH_INTERVAL_MS = 250;

/** What DownloadService needs from the app. */
export interface DownloadDeps {
  /** The download history (`downloads.json`) and its writer. */
  history(): { downloads: DownloadList; saveDownloads(): void };
  settings(): Settings;
  updateSettings(patch: SettingsPatch): Settings;
  /** Only tab pages download (never the browser UI). */
  isTabPage(contents: WebContents): boolean;
  /** The OS downloads folder (when the setting is empty). */
  defaultFolder: string;
  /** Where dangerous files wait for confirmation, under a neutral name (never in the downloads folder). */
  quarantineDir: string;
}

/**
 * Downloads (ADR-013): saved straight to the downloads folder without a dialog (unless the user
 * asked for one), under a unique name. Dangerous types are kept aside under a neutral name until
 * the user confirms them. Nothing is ever opened automatically. A session service: installed in
 * every tab session; a private session's downloads (ADR-014) are never written to the history.
 */
export class DownloadService implements SessionService {
  private readonly sessions = new WeakSet<Session>();
  /** DownloadItems of this run, by entry id. */
  private readonly items = new Map<string, DownloadItem>();
  /** The session each download of this run belongs to (a retry starts again in the same one). */
  private readonly itemSessions = new Map<string, Session>();
  /** URLs a retry asked a session to download (`retry`): the only downloads not started by a tab page. */
  private readonly retries = new WeakMap<Session, Set<string>>();
  /** Paths promised to running downloads, so two of them never pick the same unique name. */
  private readonly reserved = new Set<string>();
  private readonly changes = new Emitter<DownloadsChange>();
  private readonly pending = new Set<string>();
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private quarantineSwept = false;
  /** Private sessions (ADR-014) → ids of their downloads, kept out of downloads.json. */
  private readonly privateDownloads = new WeakMap<Session, Set<string>>();
  /** Private sessions → the opaque key their downloads are listed under (see `DownloadViewer`). */
  private readonly privateViewers = new WeakMap<Session, string>();
  /** Entries to drop once their item settles (a private window closed while they ran). */
  private readonly forgetWhenDone = new Set<string>();
  /** Downloads continued from a partial file (`createInterruptedDownload`), by session: save path → entry id. */
  private readonly resuming = new WeakMap<Session, Map<string, string>>();
  /** Entries continued from a partial file in this run → the offset they continued from. */
  private readonly resumedFrom = new Map<string, number>();
  /** Downloads the user cancelled (any other cancel, at shutdown, keeps what continuing needs). */
  private readonly userCancelled = new Set<string>();
  /** The app is quitting: the entries were set aside by `keepForRestart`, items ending now change nothing. */
  private quitting = false;

  constructor(private readonly deps: DownloadDeps) {}

  folder(current: Settings = this.deps.settings()): string {
    return current.downloads.folder || this.deps.defaultFolder;
  }

  onChanged(listener: (change: DownloadsChange) => void): () => void {
    return this.changes.on(listener);
  }

  /** The downloads a window sees (`viewerOf` its private session, or null for a normal window). */
  list(viewer: DownloadViewer): DownloadEntry[] {
    return this.deps.history().downloads.list(viewer).map(publicEntry);
  }

  /** Whether a window may see (and act on) a download: private windows' ones stay theirs (audit LOW-3). */
  isVisible(id: string, viewer: DownloadViewer): boolean {
    return this.deps.history().downloads.isVisibleTo(id, viewer);
  }

  /** Who a window's downloads belong to: null for normal windows, a private session's own key otherwise. */
  viewerOf(ses: Session | null): DownloadViewer {
    return (ses && this.privateViewers.get(ses)) ?? null;
  }

  /**
   * Handles downloads of a session. Idempotent: safe to call for every session (one per space).
   * Must run once the app is ready. `ephemeral`: a private window's session — its files are saved
   * where the user asked, but its entries are never written to the downloads history.
   */
  install(ses: Session, options: SessionOptions = {}): void {
    if (options.ephemeral && !this.privateDownloads.has(ses)) {
      this.privateDownloads.set(ses, new Set());
      this.privateViewers.set(ses, randomUUID());
    }
    if (this.sessions.has(ses)) return;
    this.sessions.add(ses);
    if (!this.quarantineSwept) {
      // Files left waiting for confirmation by a previous run are discarded (their entries come
      // back as cancelled, see `sanitizeEntry`).
      this.quarantineSwept = true;
      rmSync(this.deps.quarantineDir, { recursive: true, force: true });
    }
    ses.on("will-download", (event, item, contents) => {
      // A download continued from its partial file (ADR-054): it keeps its entry.
      const resumed = this.takeResuming(ses, item);
      if (resumed) return this.adopt(resumed, item, ses);
      // Only tab pages download: never the browser UI, nor anything else in the session, except a
      // retry the user asked for in the downloads list (main's own record of the URL).
      const retry = this.retries.get(ses);
      const retried = retry?.delete(item.getURL()) ?? false;
      if (!retried && (!contents || !this.deps.isTabPage(contents))) return event.preventDefault();
      const ids = this.privateDownloads.get(ses);
      const id = this.start(item, ids && { ids, viewer: this.privateViewers.get(ses)! });
      this.itemSessions.set(id, ses);
    });
  }

  /**
   * A private window closed: its running downloads are cancelled and its entries leave the list
   * (they were never on disk), like Chrome and Firefox do.
   */
  release(ses: Session): void {
    const ids = this.privateDownloads.get(ses);
    if (!ids) return;
    for (const id of ids) {
      const item = this.items.get(id);
      if (item) {
        this.forgetWhenDone.add(id);
        item.cancel();
      } else {
        // A dangerous file still waiting for confirmation is discarded first.
        if (this.deps.history().downloads.get(id)?.awaitingConfirmation) this.cancel(id);
        this.forget(id);
      }
    }
    this.privateDownloads.delete(ses);
    this.privateViewers.delete(ses);
  }

  pause(id: string): void {
    const item = this.items.get(id);
    if (item?.getState() === "progressing" && !item.isPaused()) item.pause();
  }

  /**
   * "Reprendre": a paused download continues; an interrupted one (in this run or a previous one)
   * continues from its partial file when it can (ADR-054), else starts over (`retry`).
   */
  resume(id: string, fallback?: Session): void {
    const item = this.items.get(id);
    if (item) {
      if (item.canResume()) item.resume();
      return;
    }
    if (fallback) this.retry(id, fallback);
  }

  /** Cancels a running download, or discards a dangerous file waiting for confirmation. */
  cancel(id: string): void {
    const item = this.items.get(id);
    if (item) {
      this.userCancelled.add(id);
      return item.cancel();
    }
    const { downloads, saveDownloads } = this.deps.history();
    const entry = downloads.get(id);
    if (entry?.resume && entry.state === "interrupted") {
      // An unfinished download of a previous run: its partial file goes, as Chrome does.
      discardFile(entry.path);
      discardFile(partialPath(entry.path));
      downloads.update(id, ({ resume: _resume, ...current }) => ({ ...current, state: "cancelled", canResume: false }));
      saveDownloads();
      return this.push(id, true);
    }
    if (!entry?.awaitingConfirmation) return;
    discardFile(this.quarantined(id));
    downloads.update(id, (current) => ({ ...current, state: "cancelled", awaitingConfirmation: false, path: "" }));
    saveDownloads();
    this.push(id, true);
  }

  /**
   * The user keeps a dangerous file: it moves from the quarantine to the downloads folder (or where
   * the save dialog says) under its real, unique name. Only once it is complete.
   */
  async keep(id: string, window?: BaseWindow): Promise<void> {
    const { downloads, saveDownloads } = this.deps.history();
    const entry = downloads.get(id);
    if (!entry?.awaitingConfirmation || entry.state !== "completed") return;
    const source = this.quarantined(id);
    let target = "";
    let reservedTarget = "";
    try {
      if (this.deps.settings().downloads.askWhere) {
        const options = { defaultPath: join(this.folder(), entry.filename) };
        const result = await (window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options));
        if (result.canceled || !result.filePath) return;
        target = result.filePath;
      } else {
        const folder = this.folder();
        mkdirSync(folder, { recursive: true });
        target = reservedTarget = this.reservePath(folder, entry.filename);
      }
      // The entry may have been discarded while the dialog was open.
      if (!downloads.get(id)?.awaitingConfirmation) return;
      mkdirSync(dirname(target), { recursive: true });
      moveFile(source, target);
    } catch (error) {
      // Folder missing and not creatable, no permission, disk full…: the file stays aside, still
      // waiting for confirmation, and the UI gets the entry back as it is (it can try again).
      console.error("[downloads] cannot keep", entry.filename, error);
      this.push(id, true);
      return;
    } finally {
      if (reservedTarget) this.reserved.delete(reservedTarget);
    }
    downloads.update(id, (current) => ({ ...current, awaitingConfirmation: false, path: target, filename: basename(target) }));
    saveDownloads();
    this.push(id, true);
  }

  /**
   * Opens a completed download with its default app: only ever on the user's request, and only for
   * types whose default app does not run code (`canOpenFile`, ADR-018); the others are shown in their folder.
   */
  open(id: string): void {
    const entry = this.deps.history().downloads.get(id);
    if (entry && canOpenFile(entry) && existsSync(entry.path)) void shell.openPath(entry.path);
  }

  showInFolder(id: string): void {
    const entry = this.deps.history().downloads.get(id);
    if (!entry || !isOpenable(entry)) return;
    if (existsSync(entry.path)) shell.showItemInFolder(entry.path);
    else void shell.openPath(dirname(entry.path));
  }

  remove(id: string): void {
    this.forget(id);
  }

  /**
   * "Réessayer": a failed or interrupted download, in the session it came from (`fallback`, the
   * window's tab session, when it is from a previous run). It continues from its partial file when
   * the server's validators were kept (ADR-054: `session.createInterruptedDownload`; a server that
   * refuses the range makes Chromium start over); otherwise it starts again from its original URL
   * and the old entry gives way to the new one.
   */
  retry(id: string, fallback: Session): void {
    const entry = this.deps.history().downloads.get(id);
    if (!entry || (entry.state !== "interrupted" && entry.state !== "cancelled") || entry.awaitingConfirmation) return;
    if (!/^https?:/i.test(entry.url)) return;
    const ses = this.itemSessions.get(id) ?? fallback;
    if (!this.sessions.has(ses)) return;
    if (entry.resume) restorePartial(entry.path);
    const plan = resumePlan(entry, fileSize(entry.path));
    if (plan && !this.privateDownloads.has(ses) && !this.reserved.has(plan.path)) {
      let pending = this.resuming.get(ses);
      if (!pending) this.resuming.set(ses, (pending = new Map()));
      pending.set(plan.path, id);
      this.reserved.add(plan.path);
      this.resumedFrom.set(id, plan.offset);
      try {
        ses.createInterruptedDownload(plan);
        return;
      } catch (error) {
        console.error("[downloads] cannot continue", entry.filename, error);
        pending.delete(plan.path);
        this.reserved.delete(plan.path);
        this.resumedFrom.delete(id);
      }
    }
    let pending = this.retries.get(ses);
    if (!pending) this.retries.set(ses, (pending = new Set()));
    pending.add(entry.url);
    this.items.delete(id);
    this.itemSessions.delete(id);
    this.forget(id);
    ses.downloadURL(entry.url);
  }

  /**
   * The app quits (ADR-054, `will-quit`): Chromium cancels running downloads at shutdown and deletes
   * their partial file. Each unfinished download that can continue (validators kept, not private, not
   * dangerous) gets a hard link to its file, `<name>.crdownload`, which outlives that deletion and is
   * put back when it continues; its entry is saved as interrupted, ready for "Reprendre".
   */
  keepForRestart(): void {
    if (this.quitting) return;
    this.quitting = true;
    const { downloads, saveDownloads } = this.deps.history();
    let changed = false;
    for (const entry of downloads.list()) {
      const unfinished = entry.state === "progressing" || entry.state === "paused" || entry.state === "interrupted";
      if (!unfinished || entry.dangerous || entry.awaitingConfirmation || !entry.path || downloads.isEphemeral(entry.id)) continue;
      const item = this.items.get(entry.id);
      const resume = (item && resumeStateOf(resumeSourceOf(item))) ?? entry.resume;
      if (!resume || fileSize(entry.path) === null) continue;
      try {
        const kept = partialPath(entry.path);
        rmSync(kept, { force: true });
        linkSync(entry.path, kept);
      } catch (error) {
        // A file system without hard links (FAT): the download will start over.
        console.error("[downloads] cannot keep", entry.filename, error);
        continue;
      }
      downloads.update(entry.id, (current) => ({
        ...current,
        state: "interrupted",
        canResume: true,
        speed: 0,
        receivedBytes: item ? Math.max(0, item.getReceivedBytes()) : current.receivedBytes,
        endedAt: current.endedAt ?? Date.now(),
        resume,
      }));
      changed = true;
    }
    if (changed) saveDownloads();
  }

  /** Forgets the finished downloads `viewer` sees (other windows' entries stay). */
  clear(viewer: DownloadViewer): void {
    const { downloads, saveDownloads } = this.deps.history();
    const removed = downloads.clearFinished(viewer);
    if (!removed.length) return;
    saveDownloads();
    for (const id of removed) this.pending.delete(id);
    this.flush(removed);
  }

  /** Native folder picker; the choice becomes the downloads folder setting. */
  async chooseFolder(window?: BaseWindow): Promise<Settings> {
    const options: Electron.OpenDialogOptions = {
      title: t("downloadsService.downloadsFolder"),
      defaultPath: this.folder(),
      properties: ["openDirectory", "createDirectory"],
    };
    const result = await (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options));
    const folder = result.filePaths[0];
    if (result.canceled || !folder) return this.deps.settings();
    return this.deps.updateSettings({ downloads: { folder } });
  }

  private quarantined(id: string): string {
    return join(this.deps.quarantineDir, `${id}.download`);
  }

  /** A free name in `folder`, reserved until the download ends. */
  private reservePath(folder: string, filename: string): string {
    const name = uniqueFilename(filename, (candidate) => this.reserved.has(join(folder, candidate)) || existsSync(join(folder, candidate)));
    const path = join(folder, name);
    this.reserved.add(path);
    return path;
  }

  private start(item: DownloadItem, owner?: { ids: Set<string>; viewer: string }): string {
    const id = randomUUID();
    owner?.ids.add(id);
    const { askWhere } = this.deps.settings().downloads;
    const filename = sanitizeFilename(item.getFilename());
    const dangerous = isDangerousFile(filename);
    const entry: DownloadEntry = {
      id,
      url: item.getURL(),
      filename,
      path: "",
      mimeType: item.getMimeType(),
      totalBytes: Math.max(0, item.getTotalBytes()),
      receivedBytes: 0,
      state: "progressing",
      speed: 0,
      dangerous,
      awaitingConfirmation: dangerous,
      canResume: false,
      startedAt: Date.now(),
      endedAt: null,
    };

    let reservedPath: string | null = null;
    if (dangerous) {
      mkdirSync(this.deps.quarantineDir, { recursive: true });
      item.setSavePath(this.quarantined(id));
    } else if (askWhere) {
      // Electron shows its save dialog for an item without a save path.
      item.setSaveDialogOptions({ defaultPath: join(this.folder(), filename) });
    } else {
      const folder = this.folder();
      try {
        mkdirSync(folder, { recursive: true });
        reservedPath = this.reservePath(folder, filename);
        item.setSavePath(reservedPath);
        entry.path = reservedPath;
        entry.filename = basename(reservedPath);
      } catch {
        // Unusable folder (removed drive…): fall back to asking.
        item.setSaveDialogOptions({ defaultPath: join(this.deps.defaultFolder, filename) });
      }
    }

    this.items.set(id, item);
    const { downloads, saveDownloads } = this.deps.history();
    const dropped = downloads.add(entry, { owner: owner?.viewer });
    saveDownloads();
    this.push(id, true, dropped);
    this.track(id, item, reservedPath);
    return id;
  }

  /** The entry a download continued from its partial file belongs to (and forgets the request). */
  private takeResuming(ses: Session, item: DownloadItem): string | null {
    const pending = this.resuming.get(ses);
    if (!pending) return null;
    const path = item.getSavePath();
    const id = pending.get(path);
    if (id === undefined) return null;
    pending.delete(path);
    return this.deps.history().downloads.get(id) ? id : null;
  }

  /**
   * A download continued from its partial file (ADR-054): Electron hands it over interrupted; it keeps
   * its entry, its path stays reserved until it ends, and it starts again.
   */
  private adopt(id: string, item: DownloadItem, ses: Session): void {
    this.items.set(id, item);
    this.itemSessions.set(id, ses);
    this.userCancelled.delete(id);
    const { downloads, saveDownloads } = this.deps.history();
    downloads.update(id, (entry) => ({ ...entry, state: "progressing", canResume: false, endedAt: null, speed: 0 }));
    saveDownloads();
    this.push(id, true);
    this.track(id, item, item.getSavePath());
    item.resume();
  }

  private track(id: string, item: DownloadItem, reservedPath: string | null): void {
    item.on("updated", () => this.update(id, item, false));
    item.once("done", () => {
      this.items.delete(id);
      if (reservedPath) this.reserved.delete(reservedPath);
      const done = this.update(id, item, true);
      this.userCancelled.delete(id);
      this.resumedFrom.delete(id);
      if (!done || this.quitting) return;
      // A partial file kept at the last quit (same bytes, another name) is not needed any more.
      if (done.state !== "interrupted" && done.path) discardFile(partialPath(done.path));
      if (this.forgetWhenDone.delete(id)) {
        if (done.dangerous) discardFile(item.getSavePath());
        return this.forget(id);
      }
      // A save dialog that was cancelled: nothing was downloaded, nothing to remember.
      if (done.state === "cancelled" && !done.path && !done.dangerous) return this.forget(id);
      // A dangerous download that did not complete leaves nothing behind.
      if (done.dangerous && !done.awaitingConfirmation && done.state !== "completed") discardFile(item.getSavePath());
    });
  }

  /** Applies the item's current state; state changes are saved and pushed immediately. */
  private update(id: string, item: DownloadItem, final: boolean): DownloadEntry | undefined {
    const { downloads, saveDownloads } = this.deps.history();
    const before = downloads.get(id);
    if (!before || this.quitting) return before;
    const after = downloads.update(id, (entry) => {
      const next = applySnapshot(entry, snapshot(item), Date.now());
      // Save dialog: the path is known once the user picked it.
      if (!entry.dangerous && !entry.path && item.getSavePath()) {
        next.path = item.getSavePath();
        next.filename = basename(next.path);
      }
      return this.withResumeState(id, item, next, final);
    })!;
    const changed = final || after.state !== before.state || after.path !== before.path || !sameResumeState(after.resume, before.resume);
    if (changed) saveDownloads();
    this.push(id, changed);
    return after;
  }

  /**
   * What continuing after a restart needs (ADR-054), kept while the download is unfinished: never for
   * a private window's download nor a dangerous file (its quarantine is emptied at startup). A cancel
   * the user did not ask for (the app quitting) leaves it interrupted, ready to continue; one that
   * continued from its partial file and failed again without a byte more starts over next time.
   */
  private withResumeState(id: string, item: DownloadItem, entry: DownloadEntry, final: boolean): DownloadEntry {
    const { downloads } = this.deps.history();
    const { resume: kept, ...rest } = entry;
    if (entry.state === "completed" || this.userCancelled.has(id) || entry.dangerous || !entry.path || downloads.isEphemeral(id)) return rest;
    const resume = resumeStateOf(resumeSourceOf(item)) ?? kept;
    let next: DownloadEntry = entry;
    if (final && entry.state === "cancelled" && resume) next = { ...entry, state: "interrupted" };
    if (next.state === "cancelled") return rest;
    const offset = this.resumedFrom.get(id);
    if (final && offset !== undefined && next.state === "interrupted" && item.getReceivedBytes() <= offset) {
      const { resume: _dropped, ...restarted } = next;
      return { ...restarted, canResume: false };
    }
    next = resume ? { ...next, resume } : { ...rest, state: next.state };
    // After the item ends, Electron cannot resume it any more: continuing goes through the partial file.
    return final && next.state === "interrupted" ? { ...next, canResume: !!next.resume } : next;
  }

  /** Queues an entry for the next push (now for state changes). */
  private push(id: string, now: boolean, removed: string[] = []): void {
    this.pending.add(id);
    if (now || removed.length) return this.flush(removed);
    this.pushTimer ??= setTimeout(() => this.flush(), PUSH_INTERVAL_MS);
  }

  private flush(removed: string[] = []): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = null;
    const { downloads } = this.deps.history();
    const updated = [...this.pending].map((id) => downloads.get(id)).filter((entry) => entry !== undefined);
    this.pending.clear();
    this.changes.emit({ updated: updated.map(publicEntry), removed });
  }

  private forget(id: string): void {
    const { downloads, saveDownloads } = this.deps.history();
    if (!downloads.remove(id)) return;
    saveDownloads();
    this.pending.delete(id);
    this.flush([id]);
  }

  dispose(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = null;
  }
}

function snapshot(item: DownloadItem): ItemSnapshot {
  return {
    state: item.getState(),
    paused: item.isPaused(),
    receivedBytes: item.getReceivedBytes(),
    totalBytes: item.getTotalBytes(),
    bytesPerSecond: item.getCurrentBytesPerSecond(),
    canResume: item.canResume(),
  };
}

/** The response details a download needs to continue after a restart (ADR-054). */
function resumeSourceOf(item: DownloadItem): ResumeSource {
  try {
    return { urlChain: item.getURLChain(), etag: item.getETag(), lastModified: item.getLastModifiedTime(), startTime: item.getStartTime() };
  } catch {
    return { urlChain: [], etag: "", lastModified: "", startTime: 0 };
  }
}

/** Where an unfinished download's bytes are kept across a restart (a hard link, see `keepForRestart`). */
const partialPath = (path: string) => `${path}.crdownload`;

/** Puts a kept partial file back in its place (Chromium deleted the original name at the last quit). */
function restorePartial(path: string): void {
  const kept = partialPath(path);
  if (!path || fileSize(path) !== null || fileSize(kept) === null) return;
  try {
    renameSync(kept, path);
  } catch (error) {
    console.error("[downloads] cannot restore", path, error);
  }
}

/** Bytes of a file on disk, or null when there is none. */
function fileSize(path: string): number | null {
  if (!path) return null;
  try {
    const stats = statSync(path);
    return stats.isFile() ? stats.size : null;
  } catch {
    return null;
  }
}

function discardFile(path: string): void {
  if (path) rmSync(path, { force: true });
}

/** Moves a file, across drives too. */
function moveFile(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    copyFileSync(from, to);
    rmSync(from, { force: true });
  }
}
