/**
 * Payment cards (ADR-041): number checks, brand detection, expiry. Pure. The security code (CVC,
 * CVV, cryptogramme) is never part of the model: nothing here reads, keeps or fills it.
 */

import { t } from "../i18n";

export type CardBrand = "visa" | "mastercard" | "amex" | "discover" | "diners" | "jcb" | "unionpay" | "maestro" | "unknown";

export const CARD_BRAND_LABELS: Record<CardBrand, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
  maestro: "Maestro",
  get unknown() { return t("autofillCard.card") },
};

/** Digits of a typed number (spaces, dashes and dots dropped); null if anything else is in it. */
export function cardDigits(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const digits = value.replace(/[\s.-]/g, "");
  return /^\d+$/.test(digits) ? digits : null;
}

/** The Luhn (mod 10) checksum every payment card number satisfies. */
export function luhnValid(digits: string): boolean {
  if (!/^\d{2,}$/.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    let digit = digits.charCodeAt(digits.length - 1 - index) - 48;
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

const between = (digits: string, length: number, min: number, max: number) => {
  const value = Number(digits.slice(0, length));
  return digits.length >= length && value >= min && value <= max;
};

/** The network of a card number, from its leading digits (IIN ranges). */
export function cardBrand(digits: string): CardBrand {
  if (/^4/.test(digits)) return "visa";
  if (/^3[47]/.test(digits)) return "amex";
  if (between(digits, 2, 51, 55) || between(digits, 4, 2221, 2720)) return "mastercard";
  if (/^(6011|65)/.test(digits) || between(digits, 3, 644, 649)) return "discover";
  if (/^3[689]/.test(digits) || between(digits, 3, 300, 305)) return "diners";
  if (between(digits, 4, 3528, 3589)) return "jcb";
  if (/^62/.test(digits)) return "unionpay";
  if (/^(5[06-9]|6\d)/.test(digits)) return "maestro";
  return "unknown";
}

const LENGTHS: Record<CardBrand, readonly number[]> = {
  visa: [13, 16, 19],
  mastercard: [16],
  amex: [15],
  discover: [16, 19],
  diners: [14, 16, 19],
  jcb: [16, 17, 18, 19],
  unionpay: [16, 17, 18, 19],
  maestro: [12, 13, 14, 15, 16, 17, 18, 19],
  unknown: [12, 13, 14, 15, 16, 17, 18, 19],
};

/** A plausible card number: digits, a length its brand uses, and the Luhn checksum. */
export function isValidCardNumber(value: unknown): boolean {
  const digits = cardDigits(value);
  return !!digits && LENGTHS[cardBrand(digits)].includes(digits.length) && luhnValid(digits);
}

/** Groups of four (American Express: 4-6-5), as printed on the card. */
export function formatCardNumber(digits: string): string {
  if (cardBrand(digits) === "amex") return [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10)].filter(Boolean).join(" ");
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** What lists show: the last four digits only. */
export const maskCardNumber = (last4: string) => `•••• ${last4}`;

export interface CardExpiry {
  /** 1–12. */
  month: number;
  /** Four digits. */
  year: number;
}

/** Two-digit years are this century's (cards last a few years). */
export const fullYear = (value: number): number => (value < 100 ? 2000 + value : value);

export const isExpiry = (month: unknown, year: unknown): boolean =>
  Number.isInteger(month) && (month as number) >= 1 && (month as number) <= 12 && Number.isInteger(year) && (year as number) >= 2000 && (year as number) <= 2100;

/** "07/27", "7/2027", "07 / 27", "0727": the month and year, or null. */
export function parseExpiry(value: string): CardExpiry | null {
  const match = /^\s*(\d{1,2})\s*[/\-. ]?\s*(\d{2}|\d{4})\s*$/.exec(value);
  if (!match) return null;
  const month = Number(match[1]);
  const year = fullYear(Number(match[2]));
  return isExpiry(month, year) ? { month, year } : null;
}

/** French and English month names (prefixes long enough to be unambiguous). */
const MONTH_NAMES: readonly string[][] = [
  ["janv", "jan"],
  // i18n-ignore
  ["févr", "fevr", "feb"],
  ["mars", "mar"],
  ["avr", "apr"],
  ["mai", "may"],
  ["juin", "jun"],
  ["juil", "jul"],
  // i18n-ignore
  ["août", "aout", "aug"],
  ["sept", "sep"],
  ["oct"],
  ["nov"],
  // i18n-ignore
  ["déc", "dec"],
];

/** A month field's value ("7", "07", "juillet", "July") → 1–12. */
export function parseMonth(value: string): number | null {
  const clean = value.trim().toLowerCase();
  if (/^\d{1,2}$/.test(clean)) {
    const month = Number(clean);
    return month >= 1 && month <= 12 ? month : null;
  }
  const index = MONTH_NAMES.findIndex((names) => names.some((name) => clean.startsWith(name)));
  return index === -1 ? null : index + 1;
}

/** A year field's value ("27", "2027") → four digits. */
export function parseYear(value: string): number | null {
  const clean = value.trim();
  if (!/^(\d{2}|\d{4})$/.test(clean)) return null;
  const year = fullYear(Number(clean));
  return year >= 2000 && year <= 2100 ? year : null;
}

/** Expired once its month is over. */
export function isExpired(expiry: CardExpiry, now: Date): boolean {
  const year = now.getFullYear();
  return expiry.year < year || (expiry.year === year && expiry.month < now.getMonth() + 1);
}

const pad = (value: number) => String(value).padStart(2, "0");

/** "MM/AA" (or "MM/AAAA" when the field wants four digits). */
export const formatExpiry = (expiry: CardExpiry, fourDigitYear = false): string =>
  `${pad(expiry.month)}/${fourDigitYear ? expiry.year : pad(expiry.year % 100)}`;
