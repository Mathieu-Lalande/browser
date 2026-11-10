/**
 * "Mémoire libérée" by sleeping tabs (ADR-054), pure. An estimate, and shown as one: the page's
 * renderer process is measured (`app.getAppMetrics()`, working set) just before the tab sleeps, and
 * a process shared by several pages (same site) counts for each of them in equal parts. Memory the
 * OS hands back later, or shared with other processes, is not known exactly.
 */

/** One process as `app.getAppMetrics()` measures it. */
export interface MemorySample {
  pid: number;
  /** Working set, kilobytes. */
  memoryKb: number;
}

/**
 * The memory one page frees by closing: its process's working set divided among the pages it
 * hosts (`pagesInProcess`, at least 1), in whole kilobytes; null when the process was not measured.
 */
export function estimateFreedKb(pid: number, samples: readonly MemorySample[], pagesInProcess: number): number | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const sample = samples.find((item) => item.pid === pid);
  if (!sample || !Number.isFinite(sample.memoryKb) || sample.memoryKb <= 0) return null;
  return Math.round(sample.memoryKb / Math.max(1, Math.floor(pagesInProcess) || 1));
}

/** What the sleeping tabs freed, together. */
export interface SleepSavings {
  /** Tabs asleep now. */
  asleep: number;
  /** Of these, the ones measured before they slept (restored tabs never had a page to free). */
  measured: number;
  /** The sum of their estimates, kilobytes. */
  freedKb: number;
}

/** Totals over tabs (`isAsleep`, `sleepFreedKb` of `TabState`). */
export function sleepSavings(tabs: readonly { isAsleep?: boolean; sleepFreedKb?: number | null }[]): SleepSavings {
  let asleep = 0;
  let measured = 0;
  let freedKb = 0;
  for (const tab of tabs) {
    if (!tab.isAsleep) continue;
    asleep++;
    const kb = tab.sleepFreedKb;
    if (typeof kb === "number" && Number.isFinite(kb) && kb > 0) {
      measured++;
      freedKb += kb;
    }
  }
  return { asleep, measured, freedKb };
}
