/**
 * Web notifications (ADR-041), pure: what a page asked to show, checked and capped, how it is
 * titled (the site's name always shows, so a page cannot pass for the system or another site),
 * and the per-site rate limit. Electron shows them natively from main.
 */

export interface WebNotification {
  /** The page's own id for it (clicks are reported with it). */
  id: string;
  title: string;
  body: string;
  /** Same tag: replaces the previous one of the site. */
  tag: string;
  silent: boolean;
}

export const MAX_NOTIFICATION_TITLE = 120;
export const MAX_NOTIFICATION_BODY = 400;

// eslint-disable-next-line no-control-regex
const clean = (value: unknown, max: number): string => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, " ").trim().slice(0, max) : "");

/** A notification request from a page (page-controlled JSON text), or null. */
export function parseWebNotification(value: unknown): WebNotification | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const data = raw as Record<string, unknown>;
  if (typeof data.id !== "string" || !/^[a-z0-9]{1,32}$/.test(data.id)) return null;
  const title = clean(data.title, MAX_NOTIFICATION_TITLE);
  const body = clean(data.body, MAX_NOTIFICATION_BODY);
  if (!title && !body) return null;
  return { id: data.id, title, body, tag: clean(data.tag, 64), silent: data.silent === true };
}

/** The native notification's title: the page's title after the site's name. */
export const notificationTitle = (site: string, title: string): string => (title ? `${site} — ${title}` : site);

/** At most `limit` notifications per site within `windowMs`: a page cannot flood the desktop. */
export class NotificationThrottle {
  private readonly shown = new Map<string, number[]>();

  constructor(
    private readonly limit = 5,
    private readonly windowMs = 10_000,
  ) {}

  /** Records one for `site` and says whether it may show. */
  take(site: string, now: number): boolean {
    const recent = (this.shown.get(site) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.shown.set(site, recent);
      return false;
    }
    recent.push(now);
    this.shown.set(site, recent);
    return true;
  }
}
