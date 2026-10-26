/** Per-site zoom (`zoom.json`) and zoom steps. Pure: no Electron, no I/O. */

export const ZOOM_VERSION = 1;
/** Hosts remembered at most; the least recently zoomed are forgotten first. */
export const MAX_ZOOM_HOSTS = 2000;

/** Chrome's zoom steps. */
export const ZOOM_FACTORS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const MIN_FACTOR = ZOOM_FACTORS[0];
const MAX_FACTOR = ZOOM_FACTORS.at(-1)!;

export const sameFactor = (a: number, b: number) => Math.abs(a - b) < 0.001;

/** The factor one step in (1) or out (-1) from `current`, or `reset` for 0; undefined at the ends. */
export function nextZoomFactor(current: number, direction: 1 | -1 | 0, reset = 1): number | undefined {
  if (direction === 0) return reset;
  return direction > 0
    ? ZOOM_FACTORS.find((factor) => factor > current + 0.001)
    : ZOOM_FACTORS.findLast((factor) => factor < current - 0.001);
}

const isFactor = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= MIN_FACTOR && value <= MAX_FACTOR;

/**
 * Zoom factor per host. Only factors that differ from the default zoom are stored, so changing
 * the default later moves every site that was never zoomed by hand.
 */
export class SiteZoom {
  /** Insertion order is recency: re-zooming a host moves it to the end. */
  private readonly hosts = new Map<string, number>();

  constructor(data: Record<string, number> = {}) {
    for (const [host, factor] of Object.entries(data)) if (isFactor(factor)) this.hosts.set(host, factor);
  }

  static parse(data: unknown): Record<string, number> | null {
    if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
    const result: Record<string, number> = {};
    for (const [host, factor] of Object.entries(data)) {
      if (host && host.length <= 253 && isFactor(factor)) result[host.toLowerCase()] = factor;
    }
    return result;
  }

  get(host: string): number | undefined {
    return this.hosts.get(host);
  }

  /** The factor to apply on `host`: its own, else the default. */
  factorFor(host: string, defaultFactor: number): number {
    return this.hosts.get(host) ?? defaultFactor;
  }

  /** Remembers a factor (forgets the host when it equals the default). Returns whether anything changed. */
  set(host: string, factor: number, defaultFactor: number): boolean {
    if (!host || !isFactor(factor)) return false;
    if (sameFactor(factor, defaultFactor)) return this.hosts.delete(host);
    const previous = this.hosts.get(host);
    this.hosts.delete(host);
    this.hosts.set(host, factor);
    while (this.hosts.size > MAX_ZOOM_HOSTS) this.hosts.delete(this.hosts.keys().next().value!);
    return previous === undefined || !sameFactor(previous, factor);
  }

  get size(): number {
    return this.hosts.size;
  }

  toJSON(): Record<string, number> {
    return Object.fromEntries(this.hosts);
  }
}
