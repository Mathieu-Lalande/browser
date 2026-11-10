import { app, webContents, type WebContents } from "electron";
import { estimateFreedKb } from "@shared/sleep-memory";

/**
 * The memory a tab's page would free by sleeping (ADR-054), measured just before it is closed: its
 * renderer's working set, shared equally among the live pages of that process. An estimate (see
 * `@shared/sleep-memory`); null when it cannot be measured.
 */
export function measurePageMemoryKb(contents: WebContents): number | null {
  try {
    if (contents.isDestroyed() || contents.isCrashed()) return null;
    const pid = contents.getOSProcessId();
    if (!pid) return null;
    const samples = app.getAppMetrics().map((metric) => ({ pid: metric.pid, memoryKb: metric.memory.workingSetSize }));
    const pages = webContents.getAllWebContents().filter((other) => {
      try {
        return !other.isDestroyed() && other.getOSProcessId() === pid;
      } catch {
        return false;
      }
    }).length;
    return estimateFreedKb(pid, samples, pages);
  } catch {
    return null;
  }
}
