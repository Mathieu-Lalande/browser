import {
  emptyStats,
  forgetSite,
  pruneStats,
  recordEvent,
  sanitizeStats,
  summarizeStats,
  type PrivacyEvent,
  type PrivacyStatsData,
  type PrivacySummary,
} from "@shared/privacy-stats";
import { JsonFileWriter, readJsonFile } from "../storage/json-file";

/** Writes are grouped: a page blocking 40 requests saves the file once. */
const SAVE_DELAY = 5_000;

/**
 * The privacy dashboard's counters (ADR-046), `privacy-stats.json` in the profile: aggregated
 * counts only (see `@shared/privacy-stats`). The privacy layer records events of normal windows'
 * tabs; private windows never reach it.
 */
export class PrivacyStatsStore {
  private readonly data: PrivacyStatsData;
  private readonly writer: JsonFileWriter | null;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    file: string | null,
    private readonly now: () => number = Date.now,
  ) {
    this.writer = file ? new JsonFileWriter(file) : null;
    this.data = file ? sanitizeStats(readJsonFile(file)) : emptyStats();
    pruneStats(this.data, this.now());
  }

  record(event: PrivacyEvent): void {
    recordEvent(this.data, event, this.now());
    this.scheduleSave();
  }

  summary(site?: string | null): PrivacySummary {
    pruneStats(this.data, this.now());
    return summarizeStats(this.data, this.now(), site ? { site } : {});
  }

  /** Forgets one site's counts, or everything. */
  clear(site?: string | null): void {
    if (site) forgetSite(this.data, site);
    else for (const key of Object.keys(this.data.days)) delete this.data.days[key];
    this.save();
  }

  /** Saves now (quitting). */
  flush(): void {
    if (this.timer) this.save();
  }

  private scheduleSave(): void {
    if (this.timer || !this.writer) return;
    this.timer = setTimeout(() => this.save(), SAVE_DELAY);
    this.timer.unref?.();
  }

  private save(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    pruneStats(this.data, this.now());
    void this.writer?.save(this.data);
  }
}
