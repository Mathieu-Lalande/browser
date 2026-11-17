/**
 * Focus mode and time per site (ADR-059), the "Concentration" page (`browser://focus`). Pure:
 * which sites a focus session blocks, the remaining time, and the local per-day counters of the
 * time a site was on screen (never synced, never in a private window, 30 days kept).
 */

export const FOCUS_MINUTES = [15, 25, 50, 90] as const;
export const MAX_FOCUS_MINUTES = 240;
/** Sorted: the settings validator keeps site lists sorted. */
export const DEFAULT_FOCUS_SITES = [
  "facebook.com",
  "instagram.com",
  "netflix.com",
  "reddit.com",
  "tiktok.com",
  "twitch.tv",
  "twitter.com",
  "x.com",
  "youtube.com",
] as const;

export interface FocusState {
  /** Epoch ms when the session ends; null: no session. */
  until: number | null;
  /** Epoch ms of the session start (for the progress ring). */
  startedAt: number | null;
}

export const NO_FOCUS: FocusState = { until: null, startedAt: null };

const siteOf = (host: string) => host.toLowerCase().replace(/^www\./u, "");

/** Whether `host` is one of `sites` or below it (`m.youtube.com` for `youtube.com`). */
export function hostInSites(host: string, sites: readonly string[]): boolean {
  const site = siteOf(host);
  return !!site && sites.some((entry) => site === entry || site.endsWith(`.${entry}`));
}

/** Whether a navigation to `url` is held by the focus session running at `now`. */
export function focusBlocks(state: FocusState, sites: readonly string[], url: string, now: number): boolean {
  if (!state.until || state.until <= now) return false;
  try {
    const { protocol, hostname } = new URL(url);
    return (protocol === "http:" || protocol === "https:") && hostInSites(hostname, sites);
  } catch {
    return false;
  }
}

export function startFocus(minutes: number, now: number): FocusState {
  const length = Math.min(MAX_FOCUS_MINUTES, Math.max(1, Math.round(minutes)));
  return { startedAt: now, until: now + length * 60_000 };
}

/** Whole minutes left (rounded up), 0 when over. */
export const focusMinutesLeft = (state: FocusState, now: number): number => (state.until && state.until > now ? Math.ceil((state.until - now) / 60_000) : 0);

/** A site list typed by the user: hosts, one per line or comma, without scheme or path. */
export function parseFocusSites(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/u)) {
    const host = siteOf(raw.replace(/^[a-z]+:\/\//iu, "").split(/[/?#]/u)[0] ?? "");
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/u.test(host) && !out.includes(host)) out.push(host);
  }
  return out.slice(0, 200);
}

// --- Time per site --------------------------------------------------------------------------

export const SITE_TIME_VERSION = 1;
export const SITE_TIME_DAYS = 30;
/** A gap longer than this between two ticks is not counted (sleep, locked screen). */
export const MAX_TICK_MS = 60_000;

/** day ("2026-11-16") → site → milliseconds on screen. */
export type SiteTime = Record<string, Record<string, number>>;

export const dayKey = (now: number): string => {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/** Adds `ms` (capped at `MAX_TICK_MS`) to the site of `host` for the day of `now`, and drops days past the window. */
export function addSiteTime(data: SiteTime, host: string, ms: number, now: number): SiteTime {
  const site = siteOf(host);
  if (!site || ms <= 0) return data;
  const day = dayKey(now);
  const next: SiteTime = { ...data, [day]: { ...data[day], [site]: (data[day]?.[site] ?? 0) + Math.min(ms, MAX_TICK_MS) } };
  const oldest = dayKey(now - SITE_TIME_DAYS * 86_400_000);
  for (const key of Object.keys(next)) if (key < oldest) delete next[key];
  return next;
}

export function sanitizeSiteTime(value: unknown): SiteTime {
  const out: SiteTime = {};
  if (!value || typeof value !== "object") return out;
  for (const [day, sites] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(day) || !sites || typeof sites !== "object") continue;
    const kept: Record<string, number> = {};
    for (const [site, ms] of Object.entries(sites as Record<string, unknown>)) {
      if (typeof ms === "number" && Number.isFinite(ms) && ms > 0 && site.length <= 253) kept[site] = Math.round(ms);
    }
    out[day] = kept;
  }
  return out;
}

export interface SiteTimeSummary {
  /** Total of the last `days` days, by site, most first. */
  sites: { site: string; ms: number }[];
  /** Per day, oldest first (the bars), `days` entries. */
  days: { day: string; ms: number }[];
  totalMs: number;
}

export function summarizeSiteTime(data: SiteTime, now: number, days = 7, top = 10): SiteTimeSummary {
  const bySite = new Map<string, number>();
  const perDay: { day: string; ms: number }[] = [];
  for (let back = days - 1; back >= 0; back--) {
    const day = dayKey(now - back * 86_400_000);
    let ms = 0;
    for (const [site, value] of Object.entries(data[day] ?? {})) {
      ms += value;
      bySite.set(site, (bySite.get(site) ?? 0) + value);
    }
    perDay.push({ day, ms });
  }
  const sites = [...bySite].map(([site, ms]) => ({ site, ms })).sort((a, b) => b.ms - a.ms);
  return { sites: sites.slice(0, top), days: perDay, totalMs: sites.reduce((sum, entry) => sum + entry.ms, 0) };
}
