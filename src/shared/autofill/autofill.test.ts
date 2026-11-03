import { describe, expect, it } from "vitest";
import {
  EMPTY_AUTOFILL,
  addressLines,
  addressOutcome,
  captureFromFields,
  cardBrand,
  cardOutcome,
  classifyForm,
  countryCode,
  fillPlan,
  focusedSection,
  formatCardNumber,
  formatExpiry,
  isExpired,
  isValidCardNumber,
  luhnValid,
  mergeSyncedAddresses,
  parseExpiry,
  parseMonth,
  postalCodeValid,
  putCard,
  sanitizeAutofill,
  sanitizeCardInput,
  sanitizeFields,
  saveAddress,
  saveCard,
  summarizeCard,
  type FieldDescriptor,
} from ".";

/** A field as the page script would describe it (only what matters set). */
const field = (partial: Partial<FieldDescriptor>): FieldDescriptor => ({
  tag: "input",
  type: "text",
  autocomplete: "",
  name: "",
  id: "",
  label: "",
  placeholder: "",
  ariaLabel: "",
  maxLength: -1,
  ...partial,
});

// Fixture forms: a French checkout without autocomplete attributes, a US one with them, a card form.
const FRENCH_FORM = [
  field({ name: "prenom", label: "Prénom" }),
  field({ name: "nom", label: "Nom" }),
  field({ name: "societe", label: "Société (facultatif)" }),
  field({ name: "adresse", label: "Adresse" }),
  field({ name: "complement", label: "Complément d'adresse" }),
  field({ name: "cp", label: "Code postal", maxLength: 5 }),
  field({ name: "ville", label: "Ville" }),
  field({ tag: "select", type: "", name: "pays", label: "Pays", options: [{ value: "FR", text: "France" }, { value: "BE", text: "Belgique" }] }),
  field({ type: "tel", name: "telephone", label: "Téléphone" }),
  field({ type: "email", name: "courriel", label: "Adresse e-mail" }),
  field({ name: "code_promo", label: "Code promo" }),
];

const US_FORM = [
  field({ autocomplete: "shipping name", name: "fullName" }),
  field({ autocomplete: "shipping address-line1", name: "addr1" }),
  field({ autocomplete: "shipping address-line2", name: "addr2" }),
  field({ autocomplete: "shipping address-level2", name: "city" }),
  field({ tag: "select", type: "", autocomplete: "shipping address-level1", name: "state", options: [{ value: "CA", text: "California" }, { value: "NY", text: "New York" }] }),
  field({ autocomplete: "shipping postal-code", name: "zip" }),
  field({ autocomplete: "shipping country", name: "country" }),
];

const CARD_FORM = [
  field({ name: "cardholder", placeholder: "Nom du titulaire" }),
  field({ name: "cardnumber", label: "Numéro de carte", type: "text" }),
  field({ name: "expiry", placeholder: "MM / AA", label: "Date d'expiration" }),
  field({ name: "cvc", label: "Cryptogramme" }),
];

const SPLIT_EXPIRY_CARD_FORM = [
  field({ name: "name", label: "Name on card" }),
  field({ autocomplete: "cc-number", name: "number" }),
  field({ tag: "select", type: "", name: "exp_month", label: "Expiration month", options: Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1).padStart(2, "0"), text: String(i + 1).padStart(2, "0") })) }),
  field({ tag: "select", type: "", name: "exp_year", label: "Expiration year", options: [{ value: "2027", text: "2027" }, { value: "2028", text: "2028" }] }),
  field({ autocomplete: "cc-csc", name: "security" }),
];

const LOGIN_FORM = [field({ type: "email", name: "email", autocomplete: "username" }), field({ type: "password", name: "password" })];

describe("cards", () => {
  it("checks numbers with Luhn and the brand's lengths", () => {
    expect(luhnValid("4242424242424242")).toBe(true);
    expect(luhnValid("4242424242424241")).toBe(false);
    expect(isValidCardNumber("4242 4242 4242 4242")).toBe(true);
    expect(isValidCardNumber("3782-822463-10005")).toBe(true);
    expect(isValidCardNumber("424242424242424")).toBe(false);
    expect(isValidCardNumber("4242x4242")).toBe(false);
  });

  it("detects brands from the leading digits", () => {
    expect(cardBrand("4111111111111111")).toBe("visa");
    expect(cardBrand("5555555555554444")).toBe("mastercard");
    expect(cardBrand("2223003122003222")).toBe("mastercard");
    expect(cardBrand("378282246310005")).toBe("amex");
    expect(cardBrand("6011111111111117")).toBe("discover");
    expect(cardBrand("30569309025904")).toBe("diners");
    expect(cardBrand("3530111333300000")).toBe("jcb");
    expect(cardBrand("6200000000000005")).toBe("unionpay");
    expect(cardBrand("6759649826438453")).toBe("maestro");
    expect(cardBrand("9999")).toBe("unknown");
  });

  it("formats numbers and expiries", () => {
    expect(formatCardNumber("4242424242424242")).toBe("4242 4242 4242 4242");
    expect(formatCardNumber("378282246310005")).toBe("3782 822463 10005");
    expect(parseExpiry("07/27")).toEqual({ month: 7, year: 2027 });
    expect(parseExpiry("7 / 2027")).toEqual({ month: 7, year: 2027 });
    expect(parseExpiry("13/27")).toBeNull();
    expect(parseMonth("juillet")).toBe(7);
    expect(parseMonth("Dec")).toBe(12);
    expect(formatExpiry({ month: 3, year: 2028 })).toBe("03/28");
    expect(isExpired({ month: 10, year: 2026 }, new Date(2026, 10, 3))).toBe(true);
    expect(isExpired({ month: 11, year: 2026 }, new Date(2026, 10, 3))).toBe(false);
  });

  it("validates card input and never keeps a security code", () => {
    expect(sanitizeCardInput({ name: "A", number: "4242424242424242", expMonth: 1, expYear: 2030, nickname: "", cvc: "123" }, true)).toEqual({
      name: "A",
      number: "4242424242424242",
      expMonth: 1,
      expYear: 2030,
      nickname: "",
    });
    expect(sanitizeCardInput({ number: "4242424242424241", expMonth: 1, expYear: 2030 }, true)).toEqual({ error: "Ce numéro de carte n'est pas valide." });
    expect(sanitizeCardInput({ number: "", expMonth: 1, expYear: 2030 }, true)).toHaveProperty("error");
  });
});

describe("addresses", () => {
  it("writes addresses in each country's order", () => {
    const base = { name: "Jean Dupont", organization: "", street: "12 rue de la Paix\nBât. B", postalCode: "75002", city: "Paris", region: "", country: "FR", phone: "", email: "" };
    expect(addressLines(base)).toEqual(["Jean Dupont", "12 rue de la Paix", "Bât. B", "75002 Paris", "France"]);
    expect(addressLines({ ...base, street: "1 Main St", city: "Springfield", region: "IL", postalCode: "62701", country: "US" })).toEqual([
      "Jean Dupont",
      "1 Main St",
      "Springfield, IL 62701",
      "États-Unis",
    ]);
    expect(addressLines({ ...base, street: "10 Downing St", city: "London", postalCode: "sw1a 2aa", country: "GB" }).slice(-3)).toEqual(["LONDON", "SW1A 2AA", "Royaume-Uni"]);
  });

  it("recognizes countries and postal codes", () => {
    expect(countryCode("france")).toBe("FR");
    expect(countryCode("United States")).toBe("US");
    expect(countryCode("Deutschland")).toBe("DE");
    expect(countryCode("Atlantis")).toBeNull();
    expect(postalCodeValid("FR", "75002")).toBe(true);
    expect(postalCodeValid("FR", "7500")).toBe(false);
    expect(postalCodeValid("CA", "K1A 0B1")).toBe(true);
    expect(postalCodeValid("NL", "1012 AB")).toBe(true);
  });
});

describe("field classification", () => {
  it("classifies a French form from names and labels", () => {
    expect(classifyForm(FRENCH_FORM)).toEqual(["given-name", "family-name", "organization", "address-line1", "address-line2", "postal-code", "city", "country", "tel", "email", null]);
  });

  it("follows autocomplete tokens, ignoring section and shipping words", () => {
    expect(classifyForm(US_FORM)).toEqual(["name", "address-line1", "address-line2", "city", "region", "postal-code", "country"]);
  });

  it("reads card forms: holder, number, expiry, and the security code (never filled)", () => {
    expect(classifyForm(CARD_FORM)).toEqual(["cc-name", "cc-number", "cc-exp", "cc-csc"]);
    expect(classifyForm(SPLIT_EXPIRY_CARD_FORM)).toEqual(["cc-name", "cc-number", "cc-exp-month", "cc-exp-year", "cc-csc"]);
  });

  it("leaves login, search and unrelated fields alone", () => {
    expect(classifyForm(LOGIN_FORM)).toEqual([null, null]);
    expect(classifyForm([field({ type: "search", name: "q", placeholder: "Rechercher" })])).toEqual([null]);
    expect(focusedSection(LOGIN_FORM, 0)).toBeNull();
  });

  it("knows which section a focused field fills", () => {
    expect(focusedSection(FRENCH_FORM, 6)).toBe("address");
    expect(focusedSection(CARD_FORM, 1)).toBe("card");
    expect(focusedSection(CARD_FORM, 3)).toBeNull();
    // A lone e-mail field (newsletter) is not an address form.
    expect(focusedSection([field({ type: "email", name: "email" })], 0)).toBeNull();
  });

  it("caps and cleans page-described fields", () => {
    expect(sanitizeFields("x")).toBeNull();
    expect(sanitizeFields([{ tag: "script", name: "a".repeat(1000), maxLength: "9" }])).toEqual([
      expect.objectContaining({ tag: "input", name: "a".repeat(200), maxLength: -1 }),
    ]);
  });
});

describe("capture and fill", () => {
  const withValues = (form: FieldDescriptor[], values: (string | undefined)[]) => form.map((entry, index) => ({ ...entry, value: values[index] }));

  it("captures an address and a card, never the security code", () => {
    const address = captureFromFields(
      withValues(FRENCH_FORM, ["Jean", "Dupont", "", "12 rue de la Paix", "Bât. B", "75002", "Paris", "FR", "0601020304", "jean@exemple.fr", "PROMO"]),
    ).address;
    expect(address).toEqual({
      name: "Jean Dupont",
      organization: "",
      street: "12 rue de la Paix\nBât. B",
      postalCode: "75002",
      city: "Paris",
      region: "",
      country: "FR",
      phone: "0601020304",
      email: "jean@exemple.fr",
    });
    const card = captureFromFields(withValues(CARD_FORM, ["JEAN DUPONT", "4242 4242 4242 4242", "07 / 29", "123"])).card;
    expect(card).toEqual({ name: "JEAN DUPONT", number: "4242424242424242", month: 7, year: 2029 });
    expect(JSON.stringify(card)).not.toContain("123");
    expect(captureFromFields(withValues(CARD_FORM, ["X", "4242 4242 4242 4241", "07/29", ""])).card).toBeNull();
  });

  it("saves, merges and dedupes captures", () => {
    const fields = captureFromFields(withValues(FRENCH_FORM, ["Jean", "Dupont", "", "12 rue de la Paix", "", "75002", "Paris", "FR", "", "", ""])).address!;
    let data = saveAddress(EMPTY_AUTOFILL, fields, 1, "a1");
    expect(addressOutcome(data, fields)).toBe("same");
    expect(addressOutcome(data, { ...fields, phone: "0600000000" })).toBe("update");
    data = saveAddress(data, { ...fields, phone: "0600000000" }, 2, "a2");
    expect(data.addresses).toHaveLength(1);
    expect(data.addresses[0]).toMatchObject({ id: "a1", phone: "0600000000", updatedAt: 2 });

    const card = { name: "JEAN", number: "4242424242424242", month: 7, year: 2029 };
    data = saveCard(data, card, 3, "c1");
    expect(cardOutcome(data, card)).toBe("same");
    data = saveCard(data, { ...card, year: 2031 }, 4, "c2");
    expect(data.cards).toHaveLength(1);
    expect(summarizeCard(data.cards[0])).toEqual({ id: "c1", name: "JEAN", nickname: "", brand: "visa", last4: "4242", expMonth: 7, expYear: 2031, lastUsedAt: null });
    expect(putCard(data, "c3", { name: "", number: "4242424242424242", expMonth: 1, expYear: 2030, nickname: "" }, 5)).toEqual({ error: "Cette carte est déjà enregistrée." });
  });

  it("plans fills by field index, selects matched by option", () => {
    const address = { name: "Jean Dupont", organization: "", street: "12 rue de la Paix\nBât. B", postalCode: "75002", city: "Paris", region: "", country: "FR", phone: "0601020304", email: "jean@exemple.fr" };
    expect(fillPlan(FRENCH_FORM, { section: "address", entry: address })).toEqual([
      { index: 0, value: "Jean" },
      { index: 1, value: "Dupont" },
      { index: 3, value: "12 rue de la Paix" },
      { index: 4, value: "Bât. B" },
      { index: 5, value: "75002" },
      { index: 6, value: "Paris" },
      { index: 7, value: "FR" },
      { index: 8, value: "0601020304" },
      { index: 9, value: "jean@exemple.fr" },
    ]);
    const card = { id: "c1", name: "JEAN DUPONT", number: "4242424242424242", expMonth: 7, expYear: 2027, nickname: "", createdAt: 0, updatedAt: 0, lastUsedAt: null };
    expect(fillPlan(CARD_FORM, { section: "card", entry: card })).toEqual([
      { index: 0, value: "JEAN DUPONT" },
      { index: 1, value: "4242424242424242" },
      { index: 2, value: "07 / 27" },
    ]);
    expect(fillPlan(SPLIT_EXPIRY_CARD_FORM, { section: "card", entry: card }).map((step) => step.value)).toEqual(["JEAN DUPONT", "4242424242424242", "07", "2027"]);
    // An address never goes into card fields, nor a card into address fields.
    expect(fillPlan(CARD_FORM, { section: "address", entry: address })).toEqual([]);
  });
});

describe("stored data and sync", () => {
  it("drops invalid stored entries", () => {
    const data = sanitizeAutofill({
      addresses: [{ id: "a", street: "1 rue", city: "Paris" }, { id: "bad id", street: "x", city: "y" }, { id: "b", street: "", city: "Lyon" }],
      cards: [{ id: "c", number: "4242424242424242", expMonth: 1, expYear: 2030, cvc: "999" }, { id: "d", number: "1234", expMonth: 1, expYear: 2030 }],
    });
    expect(data.addresses.map((entry) => entry.id)).toEqual(["a"]);
    expect(data.cards.map((entry) => entry.id)).toEqual(["c"]);
    expect(JSON.stringify(data)).not.toContain("999");
  });

  it("merges synced addresses and keeps cards local", () => {
    const local = sanitizeAutofill({ addresses: [{ id: "a", street: "1 rue", city: "Paris" }], cards: [{ id: "c", number: "4242424242424242", expMonth: 1, expYear: 2030 }] });
    const merged = mergeSyncedAddresses(local, [{ id: "b", data: { name: "", organization: "", street: "2 rue", postalCode: "", city: "Lyon", region: "", country: "", phone: "", email: "", createdAt: 1, updatedAt: 1 } }], ["a"]);
    expect(merged.addresses.map((entry) => entry.id)).toEqual(["b"]);
    expect(merged.cards).toEqual(local.cards);
  });
});
