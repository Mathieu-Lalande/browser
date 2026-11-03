import { fold } from "./address";

/**
 * Field classification (ADR-041): what a form field asks for, from its `autocomplete` attribute
 * first (the standard tokens), then from its name, id, label, placeholder and aria-label matched
 * against French and English words. Pure: the page scripts only describe fields, main (or the
 * phone app) classifies them, so the rules are unit-tested on fixture forms.
 */

export type FieldKind =
  | "name"
  | "given-name"
  | "family-name"
  | "organization"
  | "street"
  | "address-line1"
  | "address-line2"
  | "address-line3"
  | "postal-code"
  | "city"
  | "region"
  | "country"
  | "tel"
  | "email"
  | "cc-name"
  | "cc-number"
  | "cc-exp"
  | "cc-exp-month"
  | "cc-exp-year"
  /** Recognized so it is never filled nor captured: the security code is never stored. */
  | "cc-csc";

export type FieldSection = "address" | "card";

export const CARD_KINDS: ReadonlySet<FieldKind> = new Set(["cc-name", "cc-number", "cc-exp", "cc-exp-month", "cc-exp-year", "cc-csc"]);

export const sectionOf = (kind: FieldKind): FieldSection => (CARD_KINDS.has(kind) ? "card" : "address");

/** One field as a page script describes it (never trusted: lengths are capped by `sanitizeFields`). */
export interface FieldDescriptor {
  tag: "input" | "select" | "textarea";
  /** Input type, lowercase ("text", "email"…); "" for select and textarea. */
  type: string;
  autocomplete: string;
  name: string;
  id: string;
  /** Text of its `<label>` (or the nearest text before it). */
  label: string;
  placeholder: string;
  ariaLabel: string;
  /** -1 when not set. */
  maxLength: number;
  /** Select options, `{ value, text }` (at most 300). */
  options?: { value: string; text: string }[];
  /** Current value: only in captures, never for password or security-code fields. */
  value?: string;
}

const AUTOCOMPLETE: Record<string, FieldKind> = {
  name: "name",
  "given-name": "given-name",
  "additional-name": "given-name",
  "family-name": "family-name",
  organization: "organization",
  "street-address": "street",
  "address-line1": "address-line1",
  "address-line2": "address-line2",
  "address-line3": "address-line3",
  "postal-code": "postal-code",
  "address-level2": "city",
  "address-level1": "region",
  country: "country",
  "country-name": "country",
  tel: "tel",
  "tel-national": "tel",
  email: "email",
  "cc-name": "cc-name",
  "cc-number": "cc-number",
  "cc-exp": "cc-exp",
  "cc-exp-month": "cc-exp-month",
  "cc-exp-year": "cc-exp-year",
  "cc-csc": "cc-csc",
};

/** The kind its `autocomplete` attribute names (section-*, shipping/billing, home/work… skipped). */
export function autocompleteKind(value: string): FieldKind | null {
  const tokens = value.toLowerCase().trim().split(/\s+/);
  for (const token of tokens.reverse()) {
    const kind = AUTOCOMPLETE[token];
    if (kind) return kind;
  }
  return null;
}

/**
 * Words tried in this order on the folded (lowercase, no accents) name, id, label, placeholder and
 * aria-label: card words first (a "nom sur la carte" is not a name), the security code before the
 * number ("card code" holds "card"), the most specific address parts before the generic ones.
 */
const RULES: readonly [FieldKind, RegExp][] = [
  ["cc-csc", /\b(cvc|cvv|cvn|csc|cid)\d?\b|security.?code|code.?(de )?securite|cryptogramme|card.?verification|verification.?(code|number)|card.?code/],
  ["cc-name", /(card|cc).?(holder|owner|name)|name.?on.?(the )?card|nom.?(du |de )?(titulaire|porteur)|titulaire|nom.?sur.?la.?carte|ccname/],
  ["cc-exp-month", /(exp|expir\w*|cc|card).?(date.?)?(month|mm|mois)\b|mois.?(d.?)?expiration|expmonth|ccmonth/],
  ["cc-exp-year", /(exp|expir\w*|cc|card).?(date.?)?(year|yy|yyyy|annee|aa|aaaa)\b|annee.?(d.?)?expiration|expyear|ccyear/],
  ["cc-exp", /expir|date.?d.?exp|\bexp(iry|date)?\b|valid.?(thru|until)|mm.?\/.?(yy|aa)|validite/],
  ["cc-number", /(card|carte|cc|credit|debit|bancaire).?(number|numero|no\b|num\b|#)|numero.?(de )?carte|cardnumber|ccnum|\bpan\b|n.?de.?carte/],
  ["email", /e.?mail|courriel|adresse.?electronique|mel\b/],
  ["tel", /phone|telephone|\btel\b|mobile|portable|cellulaire|gsm/],
  ["postal-code", /postal|post.?code|zip|\bcp\b|code.?postal|codepostal|\bplz\b|postcode/],
  ["city", /city|ville|town|commune|localite|locality|\bort\b|municipality/],
  ["region", /state|province|region|county|departement|\bcanton\b|address.?level.?1/],
  ["country", /country|pays|nation\b/],
  ["organization", /company|organi[sz]ation|societe|entreprise|business|raison.?sociale|firm/],
  ["address-line2", /(address|adresse|addr|street|rue).?(line)?.?(2|two|ii)\b|line.?2|complement|appartement|\bapt\b|suite|batiment|etage|lieu.?dit|address2|adresse2|additional.?address/],
  ["address-line3", /(address|adresse|addr).?(line)?.?(3|three|iii)\b|line.?3|address3/],
  ["street", /address|adresse|street|\brue\b|voie|addr\b|line.?1|address1|adresse1|numero.?et.?(nom.?de.?)?rue/],
  ["given-name", /first.?name|given.?name|prenom|fname|forename/],
  ["family-name", /last.?name|family.?name|surname|nom.?de.?famille|lname|\bnom\b(?!.?complet)/],
  ["name", /full.?name|\bname\b|nom.?complet|your.?name|votre.?nom|\bnom\b|destinataire|recipient/],
];

/** The words a field is known by, folded and joined (camelCase and snake_case split into words). */
function wordsOf(field: FieldDescriptor): string {
  const split = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_[\]]+/g, " ");
  return fold([field.name, field.id, field.label, field.placeholder, field.ariaLabel].map(split).join(" | ")).slice(0, 600);
}

/** What one field asks for, or null (search boxes, coupons, passwords, anything we do not fill). */
export function classifyField(field: FieldDescriptor): FieldKind | null {
  const type = field.type;
  if (field.tag === "input" && !["", "text", "email", "tel", "number", "search", "month"].includes(type)) return null;
  if (/\b(username|current-password|new-password|one-time-code)\b/i.test(field.autocomplete)) return null;
  const tagged = autocompleteKind(field.autocomplete);
  if (tagged) return tagged;
  if (/\b(off|false)\b/.test(field.autocomplete) && field.tag === "input" && type === "search") return null;
  if (type === "email") return "email";
  if (type === "tel") return "tel";
  const words = wordsOf(field);
  if (!words.replace(/[\s|]/g, "")) return null;
  if (/coupon|promo|voucher|gift|captcha|search|recherche|login|username|identifiant|password|mot.?de.?passe|otp|siret|siren|iban|bic\b|tva|vat/.test(words)) return null;
  if (type === "month") return /exp|valid/.test(words) ? "cc-exp" : null;
  for (const [kind, pattern] of RULES) if (pattern.test(words)) return kind;
  return null;
}

/**
 * The kinds of a form's fields, in order, with the context one field alone does not give: a
 * "nom" in a card form (no address part) is the cardholder, a second street field is line 2, a
 * second given/family name pair is not refilled, and a lone 4-digit select after the month is the year.
 */
export function classifyForm(fields: readonly FieldDescriptor[]): (FieldKind | null)[] {
  const kinds = fields.map(classifyField);
  // A lone "Nom" (no "Prénom" next to it) is the whole name.
  if (!kinds.includes("given-name")) {
    for (let index = 0; index < kinds.length; index++) if (kinds[index] === "family-name" && !fields[index].autocomplete.includes("family-name")) kinds[index] = "name";
  }
  const hasCard = kinds.some((kind) => kind === "cc-number");
  const hasAddressPart = kinds.some((kind) => kind === "street" || kind === "address-line1" || kind === "postal-code" || kind === "city");
  if (hasCard && !hasAddressPart) {
    for (let index = 0; index < kinds.length; index++) if (kinds[index] === "name") kinds[index] = "cc-name";
  }
  let streets = 0;
  for (let index = 0; index < kinds.length; index++) {
    if (kinds[index] !== "street" && kinds[index] !== "address-line1") continue;
    streets++;
    if (streets === 2) kinds[index] = "address-line2";
    else if (streets > 2) kinds[index] = "address-line3";
  }
  // A street field followed by a second line is the first line.
  if (kinds.includes("address-line2")) for (let index = 0; index < kinds.length; index++) if (kinds[index] === "street") kinds[index] = "address-line1";
  // Each kind is filled once: later duplicates (a confirmation e-mail is fine) keep their kind
  // only for e-mail, the others are dropped (e.g. billing and shipping in one form).
  const seen = new Set<FieldKind>();
  return kinds.map((kind) => {
    if (!kind) return null;
    if (seen.has(kind) && kind !== "email") return null;
    seen.add(kind);
    return kind;
  });
}

/** Which sections a form can be filled with: a section needs at least two usable fields (card: the number). */
export function formSections(kinds: readonly (FieldKind | null)[]): Set<FieldSection> {
  const sections = new Set<FieldSection>();
  if (kinds.includes("cc-number")) sections.add("card");
  const address = kinds.filter((kind) => kind && !CARD_KINDS.has(kind));
  const located = address.some((kind) => kind === "street" || kind === "address-line1" || kind === "postal-code" || kind === "city");
  if (address.length >= 2 && located) sections.add("address");
  return sections;
}

// --- Page input ------------------------------------------------------------------------------

export const MAX_FIELDS = 200;
const MAX_TEXT = 200;
const MAX_VALUE = 300;
const MAX_OPTIONS = 300;

const text = (value: unknown, max = MAX_TEXT): string => (typeof value === "string" ? value.slice(0, max) : "");

/** A page script's field list, checked and capped (it is page-controlled input). */
export function sanitizeFields(value: unknown): FieldDescriptor[] | null {
  if (!Array.isArray(value) || value.length > MAX_FIELDS) return null;
  const fields: FieldDescriptor[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const raw = item as Record<string, unknown>;
    const tag = raw.tag === "select" || raw.tag === "textarea" ? raw.tag : "input";
    const field: FieldDescriptor = {
      tag,
      type: text(raw.type, 20).toLowerCase(),
      autocomplete: text(raw.autocomplete),
      name: text(raw.name),
      id: text(raw.id),
      label: text(raw.label),
      placeholder: text(raw.placeholder),
      ariaLabel: text(raw.ariaLabel),
      maxLength: typeof raw.maxLength === "number" && Number.isInteger(raw.maxLength) && raw.maxLength >= -1 && raw.maxLength < 1e6 ? raw.maxLength : -1,
    };
    if (Array.isArray(raw.options)) {
      field.options = raw.options.slice(0, MAX_OPTIONS).map((option) => {
        const entry = (typeof option === "object" && option !== null ? option : {}) as Record<string, unknown>;
        return { value: text(entry.value, MAX_TEXT), text: text(entry.text, MAX_TEXT) };
      });
    }
    if (typeof raw.value === "string") field.value = raw.value.slice(0, MAX_VALUE);
    fields.push(field);
  }
  return fields;
}
