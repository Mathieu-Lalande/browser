import { isActiveDownload, type DownloadEntry, type DownloadState } from "@shared/downloads";

/** Download history (`downloads.json`) and the state reducer. Pure: no Electron, no I/O. */

export const DOWNLOADS_VERSION = 1;
/** Oldest finished entries are forgotten beyond this (the files themselves are never touched). */
export const MAX_DOWNLOADS = 500;

/** What main reads from a live Electron DownloadItem on each update. */
export interface ItemSnapshot {
  /** Electron's states; "paused" is `isPaused()` on a progressing item. */
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  paused: boolean;
  receivedBytes: number;
  totalBytes: number;
  /** Chromium's current speed estimate, bytes/s. */
  bytesPerSecond: number;
  canResume: boolean;
}

const finite = (value: number) => (Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

/** Reducer: the entry after a DownloadItem update. Finished downloads keep their end time. */
export function applySnapshot(entry: DownloadEntry, snapshot: ItemSnapshot, now: number): DownloadEntry {
  const state: DownloadState = snapshot.state === "progressing" && snapshot.paused ? "paused" : snapshot.state;
  const running = state === "progressing";
  const totalBytes = finite(snapshot.totalBytes);
  const receivedBytes = state === "completed" && totalBytes > 0 ? totalBytes : finite(snapshot.receivedBytes);
  const finished = state === "completed" || state === "cancelled" || state === "interrupted";
  return {
    ...entry,
    state,
    totalBytes,
    receivedBytes,
    speed: running ? finite(snapshot.bytesPerSecond) : 0,
    canResume: (state === "paused" || state === "interrupted") && snapshot.canResume,
    endedAt: finished ? (entry.endedAt ?? now) : null,
    // A dangerous download that did not complete has nothing left to confirm.
    awaitingConfirmation: entry.awaitingConfirmation && (state === "completed" || !finished),
  };
}

const STATES: readonly DownloadState[] = ["progressing", "paused", "completed", "cancelled", "interrupted"];
const MAX_TEXT = 8192;
const text = (value: unknown, fallback = "") => (typeof value === "string" ? value.slice(0, MAX_TEXT) : fallback);
const count = (value: unknown) => (typeof value === "number" ? finite(value) : 0);

/**
 * Validates a stored entry. Downloads cannot outlive the process that ran them: one still
 * running when the browser quit comes back interrupted, and a file that was waiting for
 * confirmation was deleted at startup (cancelled).
 */
export function sanitizeEntry(value: unknown): DownloadEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const e = value as Record<string, unknown>;
  if (typeof e.id !== "string" || !e.id || typeof e.filename !== "string") return null;
  let state = STATES.includes(e.state as DownloadState) ? (e.state as DownloadState) : "interrupted";
  const awaiting = e.awaitingConfirmation === true;
  if (state === "progressing" || state === "paused") state = "interrupted";
  if (awaiting) state = "cancelled";
  const startedAt = count(e.startedAt);
  return {
    id: e.id.slice(0, 64),
    url: text(e.url),
    filename: text(e.filename),
    path: awaiting ? "" : text(e.path),
    mimeType: text(e.mimeType),
    totalBytes: count(e.totalBytes),
    receivedBytes: count(e.receivedBytes),
    state,
    speed: 0,
    dangerous: e.dangerous === true,
    awaitingConfirmation: false,
    canResume: false,
    startedAt,
    endedAt: typeof e.endedAt === "number" && Number.isFinite(e.endedAt) ? e.endedAt : startedAt,
  };
}

/** Download history, newest first. */
export class DownloadList {
  private entries: DownloadEntry[];
  /** Downloads of private windows (ADR-014): listed during the run, never written to disk. */
  private readonly ephemeral = new Set<string>();

  constructor(entries: DownloadEntry[] = []) {
    this.entries = entries.slice(0, MAX_DOWNLOADS);
  }

  static parse(data: unknown): DownloadEntry[] | null {
    if (!Array.isArray(data)) return null;
    const seen = new Set<string>();
    const entries: DownloadEntry[] = [];
    for (const item of data) {
      const entry = sanitizeEntry(item);
      if (!entry || seen.has(entry.id)) continue;
      seen.add(entry.id);
      entries.push(entry);
    }
    return entries.sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_DOWNLOADS);
  }

  list(): DownloadEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  get(id: string): DownloadEntry | undefined {
    return this.entries.find((entry) => entry.id === id);
  }

  /** Adds a new download on top. Returns the ids of old entries dropped to stay within the cap. */
  add(entry: DownloadEntry, options: { ephemeral?: boolean } = {}): string[] {
    this.entries.unshift(entry);
    if (options.ephemeral) this.ephemeral.add(entry.id);
    const removed: string[] = [];
    // Running downloads are never dropped, however many there are.
    for (let index = this.entries.length - 1; this.entries.length > MAX_DOWNLOADS && index >= 0; index--) {
      if (isActiveDownload(this.entries[index])) continue;
      removed.push(this.entries[index].id);
      this.entries.splice(index, 1);
    }
    return removed;
  }

  /** Replaces an entry; returns it, or undefined if unknown. */
  update(id: string, change: (entry: DownloadEntry) => DownloadEntry): DownloadEntry | undefined {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index === -1) return undefined;
    this.entries[index] = change(this.entries[index]);
    return this.entries[index];
  }

  /** Forgets one finished entry (a running one must be cancelled first). */
  remove(id: string): boolean {
    const entry = this.get(id);
    if (!entry || isActiveDownload(entry) || entry.awaitingConfirmation) return false;
    this.entries = this.entries.filter((item) => item !== entry);
    this.ephemeral.delete(id);
    return true;
  }

  /** Forgets every finished entry; returns their ids. Running and unconfirmed downloads stay. */
  clearFinished(): string[] {
    const removed = this.entries.filter((entry) => !isActiveDownload(entry) && !entry.awaitingConfirmation).map((entry) => entry.id);
    const gone = new Set(removed);
    this.entries = this.entries.filter((entry) => !gone.has(entry.id));
    return removed;
  }

  /** Whether an entry comes from a private window (kept in memory only). */
  isEphemeral(id: string): boolean {
    return this.ephemeral.has(id);
  }

  /** What is saved to downloads.json: private windows' downloads are left out. */
  toJSON(): DownloadEntry[] {
    return this.ephemeral.size ? this.entries.filter((entry) => !this.ephemeral.has(entry.id)) : this.entries;
  }
}
