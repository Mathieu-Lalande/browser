import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
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

  constructor(private readonly deps: DownloadDeps) {}

  folder(current: Settings = this.deps.settings()): string {
    return current.downloads.folder || this.deps.defaultFolder;
  }

  onChanged(listener: (change: DownloadsChange) => void): () => void {
    return this.changes.on(listener);
  }

  /** The downloads a window sees (`viewerOf` its private session, or null for a normal window). */
  list(viewer: DownloadViewer): DownloadEntry[] {
    return this.deps.history().downloads.list(viewer);
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

  resume(id: string): void {
    const item = this.items.get(id);
    if (item?.canResume()) item.resume();
  }

  /** Cancels a running download, or discards a dangerous file waiting for confirmation. */
  cancel(id: string): void {
    const item = this.items.get(id);
    if (item) return item.cancel();
    const { downloads, saveDownloads } = this.deps.history();
    const entry = downloads.get(id);
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
   * "Réessayer": a failed or interrupted download starts again from its original URL, in the
   * session it came from (`fallback`, the window's tab session, when it is from a previous run).
   * The old entry gives way to the new one.
   */
  retry(id: string, fallback: Session): void {
    const entry = this.deps.history().downloads.get(id);
    if (!entry || (entry.state !== "interrupted" && entry.state !== "cancelled") || entry.awaitingConfirmation) return;
    if (!/^https?:/i.test(entry.url)) return;
    const ses = this.itemSessions.get(id) ?? fallback;
    if (!this.sessions.has(ses)) return;
    let pending = this.retries.get(ses);
    if (!pending) this.retries.set(ses, (pending = new Set()));
    pending.add(entry.url);
    this.items.delete(id);
    this.itemSessions.delete(id);
    this.forget(id);
    ses.downloadURL(entry.url);
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
      title: "Dossier des téléchargements",
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

    item.on("updated", () => this.update(id, item, false));
    item.once("done", () => {
      this.items.delete(id);
      if (reservedPath) this.reserved.delete(reservedPath);
      const done = this.update(id, item, true);
      if (!done) return;
      if (this.forgetWhenDone.delete(id)) {
        if (done.dangerous) discardFile(item.getSavePath());
        return this.forget(id);
      }
      // A save dialog that was cancelled: nothing was downloaded, nothing to remember.
      if (done.state === "cancelled" && !done.path && !done.dangerous) return this.forget(id);
      // A dangerous download that did not complete leaves nothing behind.
      if (done.dangerous && !done.awaitingConfirmation && done.state !== "completed") discardFile(item.getSavePath());
    });
    return id;
  }

  /** Applies the item's current state; state changes are saved and pushed immediately. */
  private update(id: string, item: DownloadItem, final: boolean): DownloadEntry | undefined {
    const { downloads, saveDownloads } = this.deps.history();
    const before = downloads.get(id);
    if (!before) return undefined;
    const after = downloads.update(id, (entry) => {
      const next = applySnapshot(entry, snapshot(item), Date.now());
      // Save dialog: the path is known once the user picked it.
      if (!entry.dangerous && !entry.path && item.getSavePath()) {
        next.path = item.getSavePath();
        next.filename = basename(next.path);
      }
      return next;
    })!;
    const changed = final || after.state !== before.state || after.path !== before.path;
    if (changed) saveDownloads();
    this.push(id, changed);
    return after;
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
    this.changes.emit({ updated: updated.map((entry) => ({ ...entry })), removed });
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
