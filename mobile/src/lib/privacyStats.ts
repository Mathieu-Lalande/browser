import { emptyStats, pruneStats, recordEvent, sanitizeStats, summarizeStats, type PrivacyEvent, type PrivacyStatsData, type PrivacySummary } from "@shared/privacy-stats";
import { Store } from "../state/store";
import { KEYS, loadDocument, removeDocuments, saveDocument } from "./storage";

/**
 * The phone's privacy counters (ADR-051), the same aggregated model as the desktop dashboard
 * (ADR-046, `src/shared/privacy-stats.ts`): per day, per site and per blocked domain, never a
 * URL, 30 days. Nothing is counted for private tabs (the callers check). Loaded on first use,
 * saved in groups of 5 s.
 */
export const PRIVACY_STATS_VERSION = 1;

export const privacyStatsStore = new Store<PrivacyStatsData>(emptyStats());
let loaded: Promise<void> | null = null;

export function loadPrivacyStats(): Promise<void> {
  loaded ??= loadDocument(KEYS.privacyStats, PRIVACY_STATS_VERSION).then((stored) => {
    const data = sanitizeStats(stored);
    // Events counted before the load finished are merged in.
    const early = privacyStatsStore.get();
    for (const [day, counts] of Object.entries(early.days)) data.days[day] ??= counts;
    pruneStats(data, Date.now());
    privacyStatsStore.set(data);
  });
  return loaded;
}

/** Counts events (each a new object for subscribers) and schedules the write. */
export function recordPrivacyEvents(events: readonly PrivacyEvent[], now = Date.now()): void {
  if (!events.length) return;
  void loadPrivacyStats();
  const data = JSON.parse(JSON.stringify(privacyStatsStore.get())) as PrivacyStatsData;
  for (const event of events) recordEvent(data, event, now);
  privacyStatsStore.set(data);
  saveDocument(KEYS.privacyStats, PRIVACY_STATS_VERSION, privacyStatsStore.get, 5_000);
}

export function privacySummary(site?: string, days = 30): PrivacySummary {
  return summarizeStats(privacyStatsStore.get(), Date.now(), { days, site });
}

export async function clearPrivacyStats(): Promise<void> {
  privacyStatsStore.set(emptyStats());
  await removeDocuments([KEYS.privacyStats]);
}
