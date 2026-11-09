/**
 * Privacy dashboard counters (ADR-046): aggregated counts per day, per site and per tracker
 * domain — never the URL of a request, never a timestamp finer than the day. Kept 30 days,
 * on this device only; private windows record nothing. Pure (shared with tests and the UI).
 */

import { t } from "./i18n";

export const PRIVACY_COUNTERS = ["trackers", "cookieBanners", "httpsUpgrades", "thirdPartyCookies", "fingerprinting"] as const;
export type PrivacyCounter = (typeof PRIVACY_COUNTERS)[number];
export type Counts = Record<PrivacyCounter, number>;

/** French labels of the counters (dashboard, site info). */
export const PRIVACY_COUNTER_LABELS: Record<PrivacyCounter, string> = {
  get trackers() { return t("privacyStats.trackersAdsBlocked") },
  get cookieBanners() { return t("privacyStats.cookieBannersRefused") },
  get httpsUpgrades() { return t("privacyStats.connectionsUpgradedHttps") },
  get thirdPartyCookies() { return t("privacyStats.thirdPartyCookiesBlocked") },
  get fingerprinting() { return t("privacyStats.fingerprintingAttemptsCountered") },
};

/** "45 s", "12 min", "2 h 05". */
export function formatSaved(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

/** Days kept (and shown). */
export const STATS_DAYS = 30;
/** Most sites and tracker domains kept per day: a busy day keeps its biggest ones. */
export const MAX_SITES_PER_DAY = 300;
export const MAX_TRACKERS_PER_DAY = 300;

export interface DayStats {
  totals: Counts;
  /** Site (registrable domain) of the page → its counts. */
  sites: Record<string, Counts>;
  /** Blocked domain (registrable) → requests blocked. */
  trackers: Record<string, number>;
}

export interface PrivacyStatsData {
  version: 1;
  /** `YYYY-MM-DD` (local day) → that day's counts. */
  days: Record<string, DayStats>;
}

export interface PrivacyEvent {
  counter: PrivacyCounter;
  /** The page's site; "" when unknown (still counted in the totals). */
  site: string;
  /** For `trackers`: the blocked request's site. */
  tracker?: string;
  /** How many at once (default 1). */
  count?: number;
}

export interface RankedEntry {
  name: string;
  count: number;
}

export interface PrivacySummary {
  days: number;
  totals: Counts;
  /** Oldest first, one entry per day of the period (zeros included), for the chart. */
  daily: { day: string; counts: Counts }[];
  topSites: (RankedEntry & { counts: Counts })[];
  topTrackers: RankedEntry[];
  /** Estimated time saved (ms): a coarse figure, see `estimatedSavingMs`. */
  savedMs: number;
}

export const emptyCounts = (): Counts => ({ trackers: 0, cookieBanners: 0, httpsUpgrades: 0, thirdPartyCookies: 0, fingerprinting: 0 });
export const emptyStats = (): PrivacyStatsData => ({ version: 1, days: {} });

/** The local day of `now`, `YYYY-MM-DD`. */
export function dayKey(now: number): string {
  const date = new Date(now);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The `days` local days ending with `now`'s, oldest first. */
export function periodDays(now: number, days = STATS_DAYS): string[] {
  const end = new Date(now);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - 1 - index), 12);
    return dayKey(date.getTime());
  });
}

const NAME = /^[a-z\d.-]{1,253}$/;

/** Counts one event in place (the caller owns `data`). Returns the day it went to. */
export function recordEvent(data: PrivacyStatsData, event: PrivacyEvent, now: number): string {
  const key = dayKey(now);
  const day = (data.days[key] ??= { totals: emptyCounts(), sites: {}, trackers: {} });
  const count = Math.max(1, Math.floor(event.count ?? 1));
  day.totals[event.counter] += count;
  const site = event.site.toLowerCase();
  if (NAME.test(site) && (site in day.sites || Object.keys(day.sites).length < MAX_SITES_PER_DAY)) {
    (day.sites[site] ??= emptyCounts())[event.counter] += count;
  }
  const tracker = event.tracker?.toLowerCase();
  if (event.counter === "trackers" && tracker && NAME.test(tracker) && (tracker in day.trackers || Object.keys(day.trackers).length < MAX_TRACKERS_PER_DAY)) {
    day.trackers[tracker] = (day.trackers[tracker] ?? 0) + count;
  }
  return key;
}

/** Forgets the days older than the period. Returns whether anything went. */
export function pruneStats(data: PrivacyStatsData, now: number, days = STATS_DAYS): boolean {
  const keep = new Set(periodDays(now, days));
  let changed = false;
  for (const key of Object.keys(data.days)) {
    if (!keep.has(key)) {
      delete data.days[key];
      changed = true;
    }
  }
  return changed;
}

/** Forgets a site's counts (its tracker counts stay: they are not tied to a page). */
export function forgetSite(data: PrivacyStatsData, site: string): void {
  for (const day of Object.values(data.days)) delete day.sites[site];
}

const add = (into: Counts, from: Counts) => {
  for (const counter of PRIVACY_COUNTERS) into[counter] += from[counter];
};

const total = (counts: Counts) => PRIVACY_COUNTERS.reduce((sum, counter) => sum + counts[counter], 0);

/**
 * A rough "time saved" figure, as other browsers show it: ~50 ms per blocked request and ~2 s per
 * cookie banner refused for the user. Labelled as an estimate in the UI.
 */
export const estimatedSavingMs = (totals: Counts) => totals.trackers * 50 + totals.cookieBanners * 2_000;

/** The dashboard's figures over the last `days` days (optionally for one site). */
export function summarizeStats(data: PrivacyStatsData, now: number, options: { days?: number; top?: number; site?: string } = {}): PrivacySummary {
  const days = options.days ?? STATS_DAYS;
  const top = options.top ?? 10;
  const totals = emptyCounts();
  const sites = new Map<string, Counts>();
  const trackers = new Map<string, number>();
  const daily = periodDays(now, days).map((day) => {
    const stats = data.days[day];
    const counts = emptyCounts();
    if (stats) {
      add(counts, options.site ? (stats.sites[options.site] ?? emptyCounts()) : stats.totals);
      for (const [site, siteCounts] of Object.entries(stats.sites)) {
        if (options.site && site !== options.site) continue;
        let known = sites.get(site);
        if (!known) sites.set(site, (known = emptyCounts()));
        add(known, siteCounts);
      }
      if (!options.site) for (const [tracker, count] of Object.entries(stats.trackers)) trackers.set(tracker, (trackers.get(tracker) ?? 0) + count);
    }
    add(totals, counts);
    return { day, counts };
  });
  const topSites = [...sites]
    .map(([name, counts]) => ({ name, counts, count: total(counts) }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, top);
  const topTrackers = [...trackers]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, top);
  return { days, totals, daily, topSites, topTrackers, savedMs: estimatedSavingMs(totals) };
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

function sanitizeCounts(value: unknown): Counts | null {
  if (typeof value !== "object" || value === null) return null;
  const counts = emptyCounts();
  for (const counter of PRIVACY_COUNTERS) {
    const count = (value as Record<string, unknown>)[counter];
    if (isCount(count)) counts[counter] = Math.floor(count);
  }
  return counts;
}

/** The stored file, validated (anything malformed is dropped). */
export function sanitizeStats(value: unknown): PrivacyStatsData {
  const data = emptyStats();
  const days = (value as { days?: unknown } | null)?.days;
  if (typeof days !== "object" || days === null) return data;
  for (const [key, raw] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || typeof raw !== "object" || raw === null) continue;
    const { totals, sites, trackers } = raw as Record<string, unknown>;
    const day: DayStats = { totals: sanitizeCounts(totals) ?? emptyCounts(), sites: {}, trackers: {} };
    if (typeof sites === "object" && sites !== null) {
      for (const [site, counts] of Object.entries(sites).slice(0, MAX_SITES_PER_DAY)) {
        const clean = NAME.test(site) ? sanitizeCounts(counts) : null;
        if (clean) day.sites[site] = clean;
      }
    }
    if (typeof trackers === "object" && trackers !== null) {
      for (const [tracker, count] of Object.entries(trackers).slice(0, MAX_TRACKERS_PER_DAY)) {
        if (NAME.test(tracker) && isCount(count)) day.trackers[tracker] = Math.floor(count);
      }
    }
    data.days[key] = day;
  }
  return data;
}
