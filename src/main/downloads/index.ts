import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { app, dialog, shell, type BaseWindow, type DownloadItem, type Session } from "electron";
import { canOpenFile, isOpenable, type DownloadEntry, type DownloadsChange } from "@shared/downloads";
import type { Settings } from "@shared/settings";
import { isTabPage } from "../privacy";
import { profile } from "../profile";
import { settings, updateSettings } from "../settings";
import { isDangerousFile, sanitizeFilename, uniqueFilename } from "./files";
import { applySnapshot, type DownloadViewer, type ItemSnapshot } from "./list";

/**
 * Downloads (ADR-013): saved straight to the downloads folder without a dialog (unless the user
 * asked for one), under a unique name. Dangerous types are kept aside under a neutral name until
 * the user confirms them. Nothing is ever opened automatically.
 */

type Listener = (change: DownloadsChange) => void;

/** Progress pushes are coalesced to this rate; state changes go out at once. */
const PUSH_INTERVAL_MS = 250;

const sessions = new WeakSet<Session>();
/** DownloadItems of this run, by entry id. */
const items = new Map<string, DownloadItem>();
/** The session each download of this run belongs to (a retry starts again in the same one). */
const itemSessions = new Map<string, Session>();
/** URLs a retry asked a session to download (`retryDownload`): the only downloads not started by a tab page. */
const retries = new WeakMap<Session, Set<string>>();
/** Paths promised to running downloads, so two of them never pick the same unique name. */
const reserved = new Set<string>();
const listeners = new Set<Listener>();
const pending = new Set<string>();
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let quarantineSwept = false;

/** Where dangerous files wait for confirmation, under a neutral name (never in the downloads folder). */
const quarantineDir = () => join(app.getPath("userData"), "Unconfirmed downloads");

export function downloadsFolder(current: Settings = settings()): string {
  return current.downloads.folder || app.getPath("downloads");
}

export function onDownloadsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The downloads a window sees (`downloadViewerOf` its private session, or null for a normal window). */
export function listDownloads(viewer: DownloadViewer): DownloadEntry[] {
  return profile().downloads.list(viewer);
}

/** Whether a window may see (and act on) a download: private windows' ones stay theirs (audit LOW-3). */
export function isDownloadVisible(id: string, viewer: DownloadViewer): boolean {
  return profile().downloads.isVisibleTo(id, viewer);
}

/** Private sessions (ADR-014) → ids of their downloads, kept out of downloads.json. */
const privateDownloads = new WeakMap<Session, Set<string>>();
/** Private sessions → the opaque key their downloads are listed under (see `DownloadViewer`). */
const privateViewers = new WeakMap<Session, string>();

/** Who a window's downloads belong to: null for normal windows, a private session's own key otherwise. */
export function downloadViewerOf(ses: Session | null): DownloadViewer {
  return (ses && privateViewers.get(ses)) ?? null;
}

/**
 * Handles downloads of a session. Idempotent: safe to call for every session (one per space).
 * Must run once the app is ready. `ephemeral`: a private window's session — its files are saved
 * where the user asked, but its entries are never written to the downloads history.
 */
export function installDownloads(ses: Session, options: { ephemeral?: boolean } = {}): void {
  if (options.ephemeral && !privateDownloads.has(ses)) {
    privateDownloads.set(ses, new Set());
    privateViewers.set(ses, randomUUID());
  }
  if (sessions.has(ses)) return;
  sessions.add(ses);
  if (!quarantineSwept) {
    // Files left waiting for confirmation by a previous run are discarded (their entries come
    // back as cancelled, see `sanitizeEntry`).
    quarantineSwept = true;
    rmSync(quarantineDir(), { recursive: true, force: true });
  }
  ses.on("will-download", (event, item, contents) => {
    // Only tab pages download: never the browser UI, nor anything else in the session, except a
    // retry the user asked for in the downloads list (main's own record of the URL).
    const retry = retries.get(ses);
    const retried = retry?.delete(item.getURL()) ?? false;
    if (!retried && (!contents || !isTabPage(contents))) return event.preventDefault();
    const ids = privateDownloads.get(ses);
    const id = start(item, ids && { ids, viewer: privateViewers.get(ses)! });
    itemSessions.set(id, ses);
  });
}

/**
 * A private window closed: its running downloads are cancelled and its entries leave the list
 * (they were never on disk), like Chrome and Firefox do.
 */
export function forgetPrivateDownloads(ses: Session): void {
  const ids = privateDownloads.get(ses);
  if (!ids) return;
  for (const id of ids) {
    const item = items.get(id);
    if (item) {
      forgetWhenDone.add(id);
      item.cancel();
    } else {
      // A dangerous file still waiting for confirmation is discarded first.
      if (profile().downloads.get(id)?.awaitingConfirmation) cancelDownload(id);
      forget(id);
    }
  }
  privateDownloads.delete(ses);
  privateViewers.delete(ses);
}

/** Entries to drop once their item settles (a private window closed while they ran). */
const forgetWhenDone = new Set<string>();

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

/** A free name in `folder`, reserved until the download ends. */
function reservePath(folder: string, filename: string): string {
  const name = uniqueFilename(filename, (candidate) => reserved.has(join(folder, candidate)) || existsSync(join(folder, candidate)));
  const path = join(folder, name);
  reserved.add(path);
  return path;
}

function start(item: DownloadItem, owner?: { ids: Set<string>; viewer: string }): string {
  const id = randomUUID();
  owner?.ids.add(id);
  const { askWhere } = settings().downloads;
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
    mkdirSync(quarantineDir(), { recursive: true });
    item.setSavePath(join(quarantineDir(), `${id}.download`));
  } else if (askWhere) {
    // Electron shows its save dialog for an item without a save path.
    item.setSaveDialogOptions({ defaultPath: join(downloadsFolder(), filename) });
  } else {
    const folder = downloadsFolder();
    try {
      mkdirSync(folder, { recursive: true });
      reservedPath = reservePath(folder, filename);
      item.setSavePath(reservedPath);
      entry.path = reservedPath;
      entry.filename = basename(reservedPath);
    } catch {
      // Unusable folder (removed drive…): fall back to asking.
      item.setSaveDialogOptions({ defaultPath: join(app.getPath("downloads"), filename) });
    }
  }

  items.set(id, item);
  const { downloads, saveDownloads } = profile();
  const dropped = downloads.add(entry, { owner: owner?.viewer });
  saveDownloads();
  push(id, true, dropped);

  item.on("updated", () => update(id, item, false));
  item.once("done", () => {
    items.delete(id);
    if (reservedPath) reserved.delete(reservedPath);
    const done = update(id, item, true);
    if (!done) return;
    if (forgetWhenDone.delete(id)) {
      if (done.dangerous) discardFile(item.getSavePath());
      return forget(id);
    }
    // A save dialog that was cancelled: nothing was downloaded, nothing to remember.
    if (done.state === "cancelled" && !done.path && !done.dangerous) return forget(id);
    // A dangerous download that did not complete leaves nothing behind.
    if (done.dangerous && !done.awaitingConfirmation && done.state !== "completed") discardFile(item.getSavePath());
  });  return id;
}

/** Applies the item's current state; state changes are saved and pushed immediately. */
function update(id: string, item: DownloadItem, final: boolean): DownloadEntry | undefined {
  const { downloads, saveDownloads } = profile();
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
  push(id, changed);
  return after;
}

/** Queues an entry for the next push (now for state changes). */
function push(id: string, now: boolean, removed: string[] = []): void {
  pending.add(id);
  if (now || removed.length) return flush(removed);
  pushTimer ??= setTimeout(() => flush(), PUSH_INTERVAL_MS);
}

function flush(removed: string[] = []): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  const { downloads } = profile();
  const updated = [...pending].map((id) => downloads.get(id)).filter((entry) => entry !== undefined);
  pending.clear();
  const change: DownloadsChange = { updated: updated.map((entry) => ({ ...entry })), removed };
  for (const listener of listeners) listener(change);
}

function forget(id: string): void {
  if (!profile().downloads.remove(id)) return;
  profile().saveDownloads();
  pending.delete(id);
  flush([id]);
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

export function pauseDownload(id: string): void {
  const item = items.get(id);
  if (item?.getState() === "progressing" && !item.isPaused()) item.pause();
}

export function resumeDownload(id: string): void {
  const item = items.get(id);
  if (item?.canResume()) item.resume();
}

/** Cancels a running download, or discards a dangerous file waiting for confirmation. */
export function cancelDownload(id: string): void {
  const item = items.get(id);
  if (item) return item.cancel();
  const { downloads, saveDownloads } = profile();
  const entry = downloads.get(id);
  if (!entry?.awaitingConfirmation) return;
  discardFile(join(quarantineDir(), `${id}.download`));
  downloads.update(id, (current) => ({ ...current, state: "cancelled", awaitingConfirmation: false, path: "" }));
  saveDownloads();
  push(id, true);
}

/**
 * The user keeps a dangerous file: it moves from the quarantine to the downloads folder (or where
 * the save dialog says) under its real, unique name. Only once it is complete.
 */
export async function keepDownload(id: string, window?: BaseWindow): Promise<void> {
  const { downloads, saveDownloads } = profile();
  const entry = downloads.get(id);
  if (!entry?.awaitingConfirmation || entry.state !== "completed") return;
  const source = join(quarantineDir(), `${id}.download`);
  let target = "";
  let reservedTarget = "";
  try {
    if (settings().downloads.askWhere) {
      const options = { defaultPath: join(downloadsFolder(), entry.filename) };
      const result = await (window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options));
      if (result.canceled || !result.filePath) return;
      target = result.filePath;
    } else {
      const folder = downloadsFolder();
      mkdirSync(folder, { recursive: true });
      target = reservedTarget = reservePath(folder, entry.filename);
    }
    // The entry may have been discarded while the dialog was open.
    if (!downloads.get(id)?.awaitingConfirmation) return;
    mkdirSync(dirname(target), { recursive: true });
    moveFile(source, target);
  } catch (error) {
    // Folder missing and not creatable, no permission, disk full…: the file stays aside, still
    // waiting for confirmation, and the UI gets the entry back as it is (it can try again).
    console.error("[downloads] cannot keep", entry.filename, error);
    push(id, true);
    return;
  } finally {
    if (reservedTarget) reserved.delete(reservedTarget);
  }
  downloads.update(id, (current) => ({ ...current, awaitingConfirmation: false, path: target, filename: basename(target) }));
  saveDownloads();
  push(id, true);
}

/**
 * Opens a completed download with its default app: only ever on the user's request, and only for
 * types whose default app does not run code (`canOpenFile`, ADR-018); the others are shown in their folder.
 */
export function openDownload(id: string): void {
  const entry = profile().downloads.get(id);
  if (entry && canOpenFile(entry) && existsSync(entry.path)) void shell.openPath(entry.path);
}

export function showDownloadInFolder(id: string): void {
  const entry = profile().downloads.get(id);
  if (!entry || !isOpenable(entry)) return;
  if (existsSync(entry.path)) shell.showItemInFolder(entry.path);
  else void shell.openPath(dirname(entry.path));
}

export function removeDownload(id: string): void {
  forget(id);
}

/**
 * "Réessayer": a failed or interrupted download starts again from its original URL, in the
 * session it came from (`fallback`, the window's tab session, when it is from a previous run).
 * The old entry gives way to the new one.
 */
export function retryDownload(id: string, fallback: Session): void {
  const entry = profile().downloads.get(id);
  if (!entry || (entry.state !== "interrupted" && entry.state !== "cancelled") || entry.awaitingConfirmation) return;
  if (!/^https?:/i.test(entry.url)) return;
  const ses = itemSessions.get(id) ?? fallback;
  if (!sessions.has(ses)) return;
  let pending = retries.get(ses);
  if (!pending) retries.set(ses, (pending = new Set()));
  pending.add(entry.url);
  items.delete(id);
  itemSessions.delete(id);
  forget(id);
  ses.downloadURL(entry.url);
}

/** Forgets the finished downloads `viewer` sees (other windows' entries stay). */
export function clearDownloads(viewer: DownloadViewer): void {
  const removed = profile().downloads.clearFinished(viewer);
  if (!removed.length) return;
  profile().saveDownloads();
  for (const id of removed) pending.delete(id);
  flush(removed);
}

/** Native folder picker; the choice becomes the downloads folder setting. */
export async function chooseDownloadsFolder(window?: BaseWindow): Promise<Settings> {
  const options: Electron.OpenDialogOptions = {
    title: "Dossier des téléchargements",
    defaultPath: downloadsFolder(),
    properties: ["openDirectory", "createDirectory"],
  };
  const result = await (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options));
  const folder = result.filePaths[0];
  if (result.canceled || !folder) return settings();
  return updateSettings({ downloads: { folder } });
}
