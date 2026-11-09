import { t } from "../i18n";
import { fold } from "../fuzzy";

/** "255 en hexa", "0xff en binaire", "0b1010 en décimal": integers between number bases. */

export type Base = 2 | 8 | 10 | 16;

const BASE_NAMES: Record<string, Base> = {
  hexa: 16,
  hex: 16,
  hexadecimal: 16,
  binaire: 2,
  bin: 2,
  binary: 2,
  octal: 8,
  oct: 8,
  decimal: 10,
  dec: 10,
};

export const BASE_LABELS: Record<Base, string> = { 2: "binaire", 8: "octal", get 10() { return t("omniboxBases.decimal") }, get 16() { return t("omniboxBases.hexadecimal") } };

const PATTERN = /^(-?)(0x[\da-f]+|0b[01]+|0o[0-7]+|\d+)\s+(?:en|in|to|vers|→|->)\s+([a-z]+)\s*$/;

export interface BaseConversion {
  input: string;
  from: Base;
  to: Base;
  /** Upper-case digits, no prefix ("FF"). */
  result: string;
}

/** Converts an integer (decimal, or 0x/0b/0o prefixed) to the named base; null otherwise. */
export function parseBaseConversion(text: string): BaseConversion | null {
  const match = PATTERN.exec(fold(text.trim()));
  if (!match) return null;
  const [, sign, literal, name] = match;
  const to = BASE_NAMES[name];
  if (!to) return null;
  const prefix = literal.slice(0, 2);
  const from: Base = prefix === "0x" ? 16 : prefix === "0b" ? 2 : prefix === "0o" ? 8 : 10;
  const digits = from === 10 ? literal : literal.slice(2);
  const value = parseInt(digits, from);
  if (!Number.isSafeInteger(value) || (from === to && from === 10)) return null;
  const result = `${sign}${value.toString(to).toUpperCase()}`;
  return { input: `${sign}${literal}`, from, to, result };
}
