/**
 * Downloads as the chrome UI sees them (`src/main/downloads/` owns the real DownloadItems).
 * The UI only ever refers to a download by `id`: paths are shown, never sent back to main.
 */

export type DownloadState = "progressing" | "paused" | "completed" | "cancelled" | "interrupted";

export interface DownloadEntry {
  id: string;
  url: string;
  /** File name on disk (or the one it will get once confirmed). */
  filename: string;
  /** Absolute path of the file; empty until known (save dialog) or while it is kept aside. */
  path: string;
  mimeType: string;
  /** 0 when the server did not announce a size. */
  totalBytes: number;
  receivedBytes: number;
  state: DownloadState;
  /** Bytes per second while progressing, else 0. */
  speed: number;
  /** An executable or script type (see `isDangerousFile`). */
  dangerous: boolean;
  /**
   * Dangerous file kept aside under a neutral name until the user keeps ("Conserver") or
   * discards it: it never sits in the downloads folder under its real name before that.
   */
  awaitingConfirmation: boolean;
  /** An interrupted or paused download that can continue where it stopped (this run only). */
  canResume: boolean;
  /** Epoch milliseconds. */
  startedAt: number;
  endedAt: number | null;
}

/** Pushed by main to every browser UI: entries added or updated, and ids removed from the list. */
export interface DownloadsChange {
  updated: DownloadEntry[];
  removed: string[];
}

export const isActiveDownload = (entry: DownloadEntry) => entry.state === "progressing" || entry.state === "paused";

/** "Ouvrir" / "Afficher dans le dossier" make sense: the file is complete and in its final place. */
export const isOpenable = (entry: DownloadEntry) => entry.state === "completed" && !entry.awaitingConfirmation && entry.path !== "";

const UNITS = ["o", "Ko", "Mo", "Go", "To"];
const decimal = (value: number, digits: number) =>
  value.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: digits });

/** 3_400_000 → "3,2 Mo" (binary multiples, French units). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} o`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${decimal(value, value < 10 ? 1 : 0)} ${UNITS[unit]}`;
}

/** Remaining time: "8 s", "3 min", "2 h 05". */
export function formatDuration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, "0")}`;
}

/** One status line: "1,2 Mo / 10 Mo · 850 Ko/s · 11 s", "Terminé · 10 Mo", … */
export function downloadStatus(entry: DownloadEntry): string {
  const size = entry.totalBytes > 0 ? formatBytes(entry.totalBytes) : formatBytes(entry.receivedBytes);
  if (entry.awaitingConfirmation) {
    return entry.state === "completed" ? "Fichier potentiellement dangereux · à confirmer" : "Fichier potentiellement dangereux";
  }
  switch (entry.state) {
    case "completed":
      return `Terminé · ${size}`;
    case "cancelled":
      return "Annulé";
    case "interrupted":
      return entry.canResume ? "Interrompu · peut reprendre" : "Échec du téléchargement";
    case "paused":
      return `En pause · ${formatBytes(entry.receivedBytes)}${entry.totalBytes > 0 ? ` / ${size}` : ""}`;
    default: {
      const parts = [entry.totalBytes > 0 ? `${formatBytes(entry.receivedBytes)} / ${size}` : formatBytes(entry.receivedBytes)];
      if (entry.speed > 0) {
        parts.push(`${formatBytes(entry.speed)}/s`);
        // Time left, kept short: the line must fit the popover.
        if (entry.totalBytes > entry.receivedBytes) parts.push(formatDuration((entry.totalBytes - entry.receivedBytes) / entry.speed));
      }
      return parts.join(" · ");
    }
  }
}

/** Overall progress of the running downloads, 0…1, or null when none runs or no size is known. */
export function overallProgress(entries: readonly DownloadEntry[]): number | null {
  const running = entries.filter(isActiveDownload);
  const total = running.reduce((sum, entry) => sum + entry.totalBytes, 0);
  if (running.length === 0 || running.some((entry) => entry.totalBytes <= 0) || total === 0) return null;
  return Math.min(1, running.reduce((sum, entry) => sum + entry.receivedBytes, 0) / total);
}
