import { getLocale, type Locale } from "./locale";

/**
 * `Intl` helpers in the UI language (ADR-052): dates, numbers, relative times, units, lists.
 * Each takes an optional locale; by default the one set with `setLocale`.
 */

const TAGS: Record<Locale, string> = { fr: "fr-FR", en: "en-US" };

/** The BCP 47 tag `Intl` gets for a UI language ("fr-FR", "en-US"). */
export function intlLocale(locale: Locale = getLocale()): string {
  return TAGS[locale];
}

export function formatDate(value: Date | number, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }, locale?: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), options).format(value);
}

/** "14:05" / "02:05 PM". */
export function formatTime(value: Date | number, locale?: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { hour: "2-digit", minute: "2-digit" }).format(value);
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions, locale?: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value);
}

/** A number with a unit ("12 km/h"): `Intl` units when supported, else the number and the unit. */
export function formatUnit(value: number, unit: string, options: Intl.NumberFormatOptions = {}, locale?: Locale): string {
  try {
    return new Intl.NumberFormat(intlLocale(locale), { ...options, style: "unit", unit }).format(value);
  } catch {
    return `${formatNumber(value, options, locale)} ${unit}`;
  }
}

const RELATIVE_STEPS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
  ["week", 4.345],
  ["month", 12],
  ["year", Infinity],
];

/** "il y a 5 minutes" / "in 2 days": `time` relative to `now` (ms), in the largest fitting unit. */
export function formatRelativeTime(time: number, now = Date.now(), locale?: Locale): string {
  let amount = (time - now) / 1000;
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(amount) < size) return new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" }).format(Math.round(amount), unit);
    amount /= size;
  }
  return formatDate(time, undefined, locale);
}

/** "a, b et c" / "a, b, and c". */
export function formatList(items: readonly string[], type: "conjunction" | "disjunction" = "conjunction", locale?: Locale): string {
  try {
    return new Intl.ListFormat(intlLocale(locale), { type }).format(items);
  } catch {
    return items.join(", ");
  }
}

/** Locale-aware string comparison, for sorting. */
export function compareText(a: string, b: string, locale?: Locale): number {
  return a.localeCompare(b, intlLocale(locale));
}
