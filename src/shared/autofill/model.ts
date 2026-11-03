import { COUNTRIES, countryCode, fold, splitName, type AddressFields } from "./address";
import { cardBrand, cardDigits, isExpiry, isValidCardNumber, parseExpiry, parseMonth, parseYear, type CardBrand, type CardExpiry } from "./card";
import { classifyForm, formSections, sectionOf, type FieldDescriptor, type FieldKind, type FieldSection } from "./classify";

/**
 * Saved addresses and payment cards (ADR-041), shared by the desktop (main process) and the phone.
 * Pure. Each platform encrypts the whole store at rest (desktop `safeStorage`, phone
 * `expo-secure-store`). A card keeps its holder, number and expiry: never its security code.
 */

export interface SavedAddress extends AddressFields {
  id: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
}

export interface SavedCard {
  id: string;
  /** Cardholder, as printed. */
  name: string;
  /** Digits only. */
  number: string;
  expMonth: number;
  expYear: number;
  /** User's own label ("Carte pro"), may be empty. */
  nickname: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
}

export interface AutofillData {
  addresses: SavedAddress[];
  cards: SavedCard[];
}

/** What a list or suggestion shows of a card: never the number, only its last four digits. */
export interface CardSummary {
  id: string;
  name: string;
  nickname: string;
  brand: CardBrand;
  last4: string;
  expMonth: number;
  expYear: number;
  lastUsedAt: number | null;
}

export const EMPTY_AUTOFILL: AutofillData = { addresses: [], cards: [] };
export const MAX_ADDRESSES = 200;
export const MAX_CARDS = 50;
const MAX_FIELD = 200;
const MAX_STREET = 400;

export const isAutofillId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);

// eslint-disable-next-line no-control-regex
const clean = (value: unknown, max = MAX_FIELD): string => (typeof value === "string" ? value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim().slice(0, max) : "");
const cleanStreet = (value: unknown): string =>
  clean(value, MAX_STREET)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("\n");
const time = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback);

/** Address fields from anything (UI input, stored or synced data): cleaned and capped. */
export function sanitizeAddressFields(value: unknown): AddressFields | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const country = clean(raw.country, 2).toUpperCase();
  const fields: AddressFields = {
    name: clean(raw.name),
    organization: clean(raw.organization),
    street: cleanStreet(raw.street),
    postalCode: clean(raw.postalCode, 20),
    city: clean(raw.city),
    region: clean(raw.region),
    country: COUNTRIES.some((entry) => entry.code === country) ? country : "",
    phone: clean(raw.phone, 40),
    email: clean(raw.email),
  };
  return isUsableAddress(fields) ? fields : null;
}

/** Worth keeping: a street with a postal code or a city. */
export const isUsableAddress = (fields: AddressFields): boolean => !!fields.street && !!(fields.postalCode || fields.city);

export interface CardInput {
  name: string;
  /** Digits (separators allowed); empty when editing without changing it. */
  number: string;
  expMonth: number;
  expYear: number;
  nickname: string;
}

/** A card from the UI: the number must pass the checks, the expiry be a real month. */
export function sanitizeCardInput(value: unknown, numberRequired: boolean): CardInput | { error: string } {
  if (typeof value !== "object" || value === null) return { error: "Carte invalide." };
  const raw = value as Record<string, unknown>;
  const digits = typeof raw.number === "string" && raw.number.trim() === "" ? "" : cardDigits(raw.number);
  if (digits === null || (digits === "" && numberRequired)) return { error: "Saisissez le numéro de la carte." };
  if (digits && !isValidCardNumber(digits)) return { error: "Ce numéro de carte n'est pas valide." };
  if (!isExpiry(raw.expMonth, raw.expYear)) return { error: "La date d'expiration n'est pas valide." };
  return { name: clean(raw.name), number: digits, expMonth: raw.expMonth as number, expYear: raw.expYear as number, nickname: clean(raw.nickname, 60) };
}

/** A stored (or decrypted) store, with every invalid entry dropped. */
export function sanitizeAutofill(value: unknown): AutofillData {
  if (typeof value !== "object" || value === null) return EMPTY_AUTOFILL;
  const raw = value as Record<string, unknown>;
  const addresses: SavedAddress[] = [];
  for (const item of Array.isArray(raw.addresses) ? raw.addresses.slice(0, MAX_ADDRESSES) : []) {
    const fields = sanitizeAddressFields(item);
    const entry = item as Record<string, unknown>;
    if (!fields || !isAutofillId(entry.id) || addresses.some((known) => known.id === entry.id)) continue;
    const createdAt = time(entry.createdAt, 0);
    addresses.push({ ...fields, id: entry.id, createdAt, updatedAt: time(entry.updatedAt, createdAt), lastUsedAt: entry.lastUsedAt == null ? null : time(entry.lastUsedAt, 0) });
  }
  const cards: SavedCard[] = [];
  for (const item of Array.isArray(raw.cards) ? raw.cards.slice(0, MAX_CARDS) : []) {
    const input = sanitizeCardInput(item, true);
    const entry = item as Record<string, unknown>;
    if ("error" in input || !isAutofillId(entry.id) || cards.some((known) => known.id === entry.id)) continue;
    const createdAt = time(entry.createdAt, 0);
    cards.push({ ...input, id: entry.id, createdAt, updatedAt: time(entry.updatedAt, createdAt), lastUsedAt: entry.lastUsedAt == null ? null : time(entry.lastUsedAt, 0) });
  }
  return { addresses, cards };
}

export const summarizeCard = (card: SavedCard): CardSummary => ({
  id: card.id,
  name: card.name,
  nickname: card.nickname,
  brand: cardBrand(card.number),
  last4: card.number.slice(-4),
  expMonth: card.expMonth,
  expYear: card.expYear,
  lastUsedAt: card.lastUsedAt,
});

/** The same place: street and postal code (or city) equal once folded. */
const addressKey = (fields: AddressFields) => `${fold(fields.street.split("\n")[0] ?? "")}|${fold(fields.postalCode || fields.city)}`;

// --- Captures -----------------------------------------------------------------------------------

/** What a submitted form held, once classified: an address and/or a card (never a security code). */
export interface AutofillCapture {
  address: AddressFields | null;
  card: (CardExpiry & { name: string; number: string }) | null;
}

/** The value a select shows (its option text) or a field holds. */
const valueOf = (field: FieldDescriptor): string => {
  const value = field.value ?? "";
  if (field.tag !== "select" || !field.options) return value;
  return field.options.find((option) => option.value === value)?.text || value;
};

/** Reads an address and a card out of a submitted form's fields (page input: everything is checked). */
export function captureFromFields(fields: readonly FieldDescriptor[]): AutofillCapture {
  const kinds = classifyForm(fields);
  const values = new Map<FieldKind, string>();
  kinds.forEach((kind, index) => {
    // The security code is never read, even when a page sent it.
    if (!kind || kind === "cc-csc") return;
    const value = valueOf(fields[index]).trim();
    if (value && !values.has(kind)) values.set(kind, value);
  });
  const get = (kind: FieldKind) => values.get(kind) ?? "";
  const name = get("name") || [get("given-name"), get("family-name")].filter(Boolean).join(" ");
  const street = get("street") || [get("address-line1"), get("address-line2"), get("address-line3")].filter(Boolean).join("\n");
  const country = countryCode(get("country")) ?? "";
  const address = sanitizeAddressFields({
    name,
    organization: get("organization"),
    street,
    postalCode: get("postal-code"),
    city: get("city"),
    region: get("region"),
    country,
    phone: get("tel"),
    email: get("email"),
  });
  let card: AutofillCapture["card"] = null;
  const number = cardDigits(get("cc-number"));
  if (number && isValidCardNumber(number)) {
    const expiry = parseExpiry(get("cc-exp")) ?? combine(parseMonth(get("cc-exp-month")), parseYear(get("cc-exp-year")));
    if (expiry) card = { ...expiry, name: clean(get("cc-name")), number };
  }
  return { address, card };
}

const combine = (month: number | null, year: number | null): CardExpiry | null => (month && year ? { month, year } : null);

export type AutofillOutcome = "new" | "update" | "same";

/** What saving a captured address would do. */
export function addressOutcome(data: AutofillData, fields: AddressFields): AutofillOutcome {
  const known = data.addresses.find((entry) => addressKey(entry) === addressKey(fields));
  if (!known) return "new";
  const keys = Object.keys(fields) as (keyof AddressFields)[];
  return keys.every((key) => !fields[key] || fields[key] === known[key]) ? "same" : "update";
}

export function cardOutcome(data: AutofillData, card: NonNullable<AutofillCapture["card"]>): AutofillOutcome {
  const known = data.cards.find((entry) => entry.number === card.number);
  if (!known) return "new";
  return known.expMonth === card.month && known.expYear === card.year && (!card.name || known.name === card.name) ? "same" : "update";
}

/** Saves a captured address: merged into the same place's entry (filled-in fields win), else added. */
export function saveAddress(data: AutofillData, fields: AddressFields, now: number, id: string): AutofillData {
  const index = data.addresses.findIndex((entry) => addressKey(entry) === addressKey(fields));
  if (index === -1) {
    if (data.addresses.length >= MAX_ADDRESSES) throw new Error("Trop d'adresses enregistrées.");
    return { ...data, addresses: [...data.addresses, { ...fields, id, createdAt: now, updatedAt: now, lastUsedAt: null }] };
  }
  const known = data.addresses[index];
  const merged = { ...known, updatedAt: now };
  for (const key of Object.keys(fields) as (keyof AddressFields)[]) if (fields[key]) merged[key] = fields[key];
  return { ...data, addresses: data.addresses.map((entry, at) => (at === index ? merged : entry)) };
}

/** Saves a captured card: same number → new expiry and name, else added. */
export function saveCard(data: AutofillData, card: NonNullable<AutofillCapture["card"]>, now: number, id: string): AutofillData {
  const known = data.cards.find((entry) => entry.number === card.number);
  if (known) {
    const updated: SavedCard = { ...known, name: card.name || known.name, expMonth: card.month, expYear: card.year, updatedAt: now };
    return { ...data, cards: data.cards.map((entry) => (entry.id === known.id ? updated : entry)) };
  }
  if (data.cards.length >= MAX_CARDS) throw new Error("Trop de cartes enregistrées.");
  return {
    ...data,
    cards: [...data.cards, { id, name: card.name, number: card.number, expMonth: card.month, expYear: card.year, nickname: "", createdAt: now, updatedAt: now, lastUsedAt: null }],
  };
}

/** Adds (`id` unknown) or replaces an address from the settings form. */
export function putAddress(data: AutofillData, id: string, fields: AddressFields, now: number): AutofillData {
  const known = data.addresses.find((entry) => entry.id === id);
  if (!known) {
    if (data.addresses.length >= MAX_ADDRESSES) throw new Error("Trop d'adresses enregistrées.");
    return { ...data, addresses: [...data.addresses, { ...fields, id, createdAt: now, updatedAt: now, lastUsedAt: null }] };
  }
  return { ...data, addresses: data.addresses.map((entry) => (entry.id === id ? { ...known, ...fields, updatedAt: now } : entry)) };
}

/** Adds (`id` unknown, number required) or edits a card (an empty number keeps the saved one). */
export function putCard(data: AutofillData, id: string, input: CardInput, now: number): AutofillData | { error: string } {
  const known = data.cards.find((entry) => entry.id === id);
  if (!known && !input.number) return { error: "Saisissez le numéro de la carte." };
  const number = input.number || known!.number;
  if (data.cards.some((entry) => entry.id !== id && entry.number === number)) return { error: "Cette carte est déjà enregistrée." };
  const card: SavedCard = {
    id,
    name: input.name,
    number,
    expMonth: input.expMonth,
    expYear: input.expYear,
    nickname: input.nickname,
    createdAt: known?.createdAt ?? now,
    updatedAt: now,
    lastUsedAt: known?.lastUsedAt ?? null,
  };
  if (!known && data.cards.length >= MAX_CARDS) return { error: "Trop de cartes enregistrées." };
  return { ...data, cards: known ? data.cards.map((entry) => (entry.id === id ? card : entry)) : [...data.cards, card] };
}

export const removeAddress = (data: AutofillData, id: string): AutofillData => ({ ...data, addresses: data.addresses.filter((entry) => entry.id !== id) });
export const removeCard = (data: AutofillData, id: string): AutofillData => ({ ...data, cards: data.cards.filter((entry) => entry.id !== id) });

export function markUsed(data: AutofillData, section: FieldSection, id: string, now: number): AutofillData {
  return section === "card"
    ? { ...data, cards: data.cards.map((entry) => (entry.id === id ? { ...entry, lastUsedAt: now } : entry)) }
    : { ...data, addresses: data.addresses.map((entry) => (entry.id === id ? { ...entry, lastUsedAt: now } : entry)) };
}

/** Most recently used first, then most recently saved. */
export const byRecentUse = <T extends { lastUsedAt: number | null; updatedAt: number }>(entries: readonly T[]): T[] =>
  [...entries].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || b.updatedAt - a.updatedAt);

// --- Filling ------------------------------------------------------------------------------------

/** One value to put in a field, by its index in the described form. */
export interface FillStep {
  index: number;
  value: string;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The option of a select matching one of `wanted` (value or text, folded), or null. */
function optionFor(field: FieldDescriptor, wanted: readonly string[]): string | null {
  const folded = wanted.filter(Boolean).map(fold);
  const option = field.options?.find((entry) => folded.includes(fold(entry.value)) || folded.includes(fold(entry.text)));
  return option ? option.value : null;
}

/** "MM/AA" or "MM/AAAA", as the field seems to want (placeholder, max length). */
function expiryText(field: FieldDescriptor, month: number, year: number): string {
  const hint = fold(`${field.placeholder} ${field.label}`);
  const fourDigits = /aaaa|yyyy/.test(hint) || field.maxLength >= 7;
  const separator = /\s\/\s/.test(field.placeholder) ? " / " : "/";
  return `${pad(month)}${separator}${fourDigits ? year : pad(year % 100)}`;
}

/** The value of one field for an address, or null (nothing to put there). */
function addressValue(kind: FieldKind, field: FieldDescriptor, address: AddressFields): string | null {
  const lines = address.street.split("\n");
  const names = splitName(address.name);
  switch (kind) {
    case "name":
      return address.name;
    case "given-name":
      return names.given;
    case "family-name":
      return names.family;
    case "organization":
      return address.organization;
    case "street":
      return field.tag === "textarea" ? address.street : lines.join(", ");
    case "address-line1":
      return lines[0] ?? "";
    case "address-line2":
      return lines[1] ?? "";
    case "address-line3":
      return lines[2] ?? "";
    case "postal-code":
      return address.postalCode;
    case "city":
      return address.city;
    case "region":
      return field.tag === "select" ? optionFor(field, [address.region]) : address.region;
    case "country": {
      const country = COUNTRIES.find((entry) => entry.code === address.country);
      if (!country) return null;
      return field.tag === "select" ? optionFor(field, [country.code, country.name, ...country.aliases]) : country.name;
    }
    case "tel":
      return address.phone;
    case "email":
      return address.email;
    default:
      return null;
  }
}

function cardValue(kind: FieldKind, field: FieldDescriptor, card: SavedCard): string | null {
  switch (kind) {
    case "cc-name":
      return card.name;
    case "cc-number":
      return card.number;
    case "cc-exp":
      return expiryText(field, card.expMonth, card.expYear);
    case "cc-exp-month":
      return field.tag === "select" ? optionFor(field, [pad(card.expMonth), String(card.expMonth)]) : pad(card.expMonth);
    case "cc-exp-year": {
      const short = pad(card.expYear % 100);
      if (field.tag === "select") return optionFor(field, [String(card.expYear), short]);
      return field.maxLength === 2 || /\b(aa|yy)\b/.test(fold(field.placeholder)) ? short : String(card.expYear);
    }
    default:
      // The security code included: never filled.
      return null;
  }
}

/** The steps that fill a form's `section` fields with an address or a card. */
export function fillPlan(fields: readonly FieldDescriptor[], fill: { section: "address"; entry: AddressFields } | { section: "card"; entry: SavedCard }): FillStep[] {
  const kinds = classifyForm(fields);
  const steps: FillStep[] = [];
  kinds.forEach((kind, index) => {
    if (!kind) return;
    const value =
      fill.section === "address" ? (sectionOf(kind) === "address" ? addressValue(kind, fields[index], fill.entry) : null) : sectionOf(kind) === "card" ? cardValue(kind, fields[index], fill.entry) : null;
    if (value) steps.push({ index, value });
  });
  return steps;
}

/** The section a focused field belongs to, when its form can be filled with it. */
export function focusedSection(fields: readonly FieldDescriptor[], focused: number): FieldSection | null {
  const kinds = classifyForm(fields);
  const kind = kinds[focused];
  if (!kind || kind === "cc-csc") return null;
  const section = sectionOf(kind);
  return formSections(kinds).has(section) ? section : null;
}

// --- Sync (ADR-019): addresses only, opt-in; cards never leave the device. ----------------------

export type SyncedAddress = AddressFields & { createdAt: number; updatedAt: number };

export const addressRecord = (entry: SavedAddress): SyncedAddress => {
  const { id: _id, lastUsedAt: _used, ...rest } = entry;
  return rest;
};

export function sanitizeSyncedAddress(value: unknown): SyncedAddress | null {
  const fields = sanitizeAddressFields(value);
  if (!fields) return null;
  const raw = value as Record<string, unknown>;
  const createdAt = time(raw.createdAt, 0);
  return { ...fields, createdAt, updatedAt: time(raw.updatedAt, createdAt) };
}

/** Applies synced winners (by local id) and deletions to the local addresses; cards are untouched. */
export function mergeSyncedAddresses(data: AutofillData, upserts: readonly { id: string; data: SyncedAddress }[], deletes: readonly string[]): AutofillData {
  const gone = new Set(deletes);
  const byId = new Map(data.addresses.filter((entry) => !gone.has(entry.id)).map((entry) => [entry.id, entry]));
  for (const { id, data: record } of upserts) {
    if (!isAutofillId(id)) continue;
    byId.set(id, { ...record, id, lastUsedAt: byId.get(id)?.lastUsedAt ?? null });
  }
  return { ...data, addresses: [...byId.values()].slice(0, MAX_ADDRESSES) };
}
