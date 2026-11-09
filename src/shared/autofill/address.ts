/**
 * Postal addresses (ADR-041): the countries offered, how an address is written in each (French and
 * European order "code postal ville", North American "City, ST ZIP", British "TOWN\nPOSTCODE"), and
 * postal code checks. Pure.
 */

import { t } from "../i18n";

export interface AddressFields {
  /** Full name, as written on a letter. */
  name: string;
  organization: string;
  /** Street lines, separated by "\n" (at most 3). */
  street: string;
  postalCode: string;
  city: string;
  /** State, province or region (US/CA states as their two-letter code). */
  region: string;
  /** ISO 3166-1 alpha-2, uppercase ("FR"); empty when unknown. */
  country: string;
  phone: string;
  email: string;
}

export type AddressLayout = "eu" | "us" | "uk";

export interface Country {
  code: string;
  /** French name, as shown in the UI. */
  name: string;
  layout: AddressLayout;
  /** Postal code pattern (whole value, case-insensitive), null when not checked. */
  postal: RegExp | null;
  /** Other names forms use for it (English, local). */
  aliases: readonly string[];
}

export const COUNTRIES: readonly Country[] = [
  { code: "FR", get name() { return t("autofillAddress.france") }, layout: "eu", postal: /^\d{5}$/, aliases: ["france", "fra"] },
  // i18n-ignore
  { code: "BE", get name() { return t("autofillAddress.belgium") }, layout: "eu", postal: /^\d{4}$/, aliases: ["belgium", "belgië", "belgie", "bel"] },
  { code: "CH", get name() { return t("autofillAddress.switzerland") }, layout: "eu", postal: /^\d{4}$/, aliases: ["switzerland", "schweiz", "svizzera", "che"] },
  { code: "LU", get name() { return t("autofillAddress.luxembourg") }, layout: "eu", postal: /^(L-?)?\d{4}$/, aliases: ["lux"] },
  { code: "MC", get name() { return t("autofillAddress.monaco") }, layout: "eu", postal: /^980\d{2}$/, aliases: ["mco"] },
  { code: "DE", get name() { return t("autofillAddress.germany") }, layout: "eu", postal: /^\d{5}$/, aliases: ["germany", "deutschland", "deu"] },
  { code: "AT", get name() { return t("autofillAddress.austria") }, layout: "eu", postal: /^\d{4}$/, aliases: ["austria", "österreich", "aut"] },
  { code: "ES", get name() { return t("autofillAddress.spain") }, layout: "eu", postal: /^\d{5}$/, aliases: ["spain", "españa", "espana", "esp"] },
  { code: "IT", get name() { return t("autofillAddress.italy") }, layout: "eu", postal: /^\d{5}$/, aliases: ["italy", "italia", "ita"] },
  { code: "PT", get name() { return t("autofillAddress.portugal") }, layout: "eu", postal: /^\d{4}-?\d{3}$/, aliases: ["prt"] },
  { code: "NL", get name() { return t("autofillAddress.netherlands") }, layout: "eu", postal: /^\d{4}\s?[a-z]{2}$/i, aliases: ["netherlands", "nederland", "nld", "holland"] },
  // i18n-ignore
  { code: "IE", get name() { return t("autofillAddress.ireland") }, layout: "uk", postal: null, aliases: ["ireland", "irl", "éire"] },
  { code: "GB", get name() { return t("autofillAddress.unitedKingdom") }, layout: "uk", postal: /^[a-z]{1,2}\d[a-z\d]?\s?\d[a-z]{2}$/i, aliases: ["united kingdom", "uk", "great britain", "england", "gbr"] },
  { code: "US", get name() { return t("autofillAddress.unitedStates") }, layout: "us", postal: /^\d{5}(-\d{4})?$/, aliases: ["united states", "usa", "united states of america", "etats-unis"] },
  { code: "CA", get name() { return t("autofillAddress.canada") }, layout: "us", postal: /^[a-z]\d[a-z]\s?\d[a-z]\d$/i, aliases: ["can"] },
];

export const countryOf = (code: string): Country | undefined => COUNTRIES.find((country) => country.code === code);

/** Strips accents and case, for comparing names a page wrote. */
export const fold = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** "France", "FR", "fra", "United States" → the ISO code we know, or null. */
export function countryCode(value: string): string | null {
  const clean = fold(value);
  if (!clean) return null;
  const found = COUNTRIES.find(
    (country) => fold(country.code) === clean || fold(country.name) === clean || country.aliases.some((alias) => fold(alias) === clean),
  );
  return found?.code ?? null;
}

/** Whether `code` is a valid postal code of `country` (unknown country or pattern: any non-empty code). */
export function postalCodeValid(country: string, code: string): boolean {
  const clean = code.trim();
  if (!clean) return false;
  const pattern = countryOf(country)?.postal;
  return pattern ? pattern.test(clean) : clean.length <= 12;
}

/** The address written as on an envelope, one line per item, in the country's order. */
export function addressLines(address: AddressFields): string[] {
  const country = countryOf(address.country);
  const layout = country?.layout ?? "eu";
  const lines = [address.name, address.organization, ...address.street.split("\n")];
  if (layout === "us") lines.push([address.city, [address.region, address.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", "));
  else if (layout === "uk") lines.push(address.city.toUpperCase(), address.region, address.postalCode.toUpperCase());
  else lines.push([address.postalCode, address.city].filter(Boolean).join(" "), address.region);
  if (country) lines.push(country.name);
  return lines.map((line) => line.trim()).filter(Boolean);
}

/** One line for lists and suggestions: "12 rue de la Paix, 75002 Paris". */
export function addressSummary(address: AddressFields): string {
  const street = address.street.split("\n")[0]?.trim() ?? "";
  const town = countryOf(address.country)?.layout === "us" ? [address.city, address.region].filter(Boolean).join(", ") : [address.postalCode, address.city].filter(Boolean).join(" ");
  return [street, town].filter(Boolean).join(", ");
}

/** "Jean Dupont" → given and family names (the last word is the family name). */
export function splitName(name: string): { given: string; family: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { given: words[0] ?? "", family: "" };
  return { given: words.slice(0, -1).join(" "), family: words.at(-1)! };
}
