import { isActiveDownload, overallProgress, type DownloadEntry } from "@shared/downloads";

/** Reactive mirror of the download list (main pushes changes to every browser UI). */
class DownloadsStore {
  /** Newest first. */
  entries = $state<DownloadEntry[]>([]);

  active: DownloadEntry[] = $derived(this.entries.filter(isActiveDownload));
  /** 0…1 for the sidebar ring; null when nothing runs or a size is unknown (indeterminate). */
  progress: number | null = $derived(overallProgress(this.entries));
  /** Dangerous files waiting for the user's decision. */
  awaiting: DownloadEntry[] = $derived(this.entries.filter((entry) => entry.awaitingConfirmation));

  constructor() {
    window.browser.downloads.onChanged(({ updated, removed }) => {
      const changed = new Map(updated.map((entry) => [entry.id, entry]));
      const gone = new Set(removed);
      const known = new Set(this.entries.map((entry) => entry.id));
      // Known entries are updated in place (keeping the order), new ones go on top.
      const kept = this.entries.filter((entry) => !gone.has(entry.id)).map((entry) => changed.get(entry.id) ?? entry);
      const fresh = updated.filter((entry) => !known.has(entry.id) && !gone.has(entry.id));
      this.entries = [...fresh, ...kept];
    });
    void window.browser.downloads.list().then(
      (list) => (this.entries = list),
      () => {},
    );
  }
}

export const downloads = new DownloadsStore();
