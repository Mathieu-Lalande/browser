import { sanitizeAutofill } from "@shared/autofill";
import { AutofillBridge, AutofillStore } from "./autofill";

const memoryStore = () => {
  const items = new Map<string, string>();
  return {
    items,
    getItemAsync: async (key: string) => items.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => void items.set(key, value),
    deleteItemAsync: async (key: string) => void items.delete(key),
  };
};

const data = sanitizeAutofill({
  addresses: [{ id: "a1", name: "Jeanne Martin", street: "12 rue de la Paix", postalCode: "75002", city: "Paris", country: "FR" }],
  cards: [{ id: "c1", name: "JEANNE MARTIN", number: "4242424242424242", expMonth: 7, expYear: 2029 }],
});

const fields = [
  { tag: "input", type: "text", name: "nom", label: "Nom" },
  { tag: "input", type: "text", name: "adresse", label: "Adresse" },
  { tag: "input", type: "text", name: "cp", label: "Code postal" },
  { tag: "input", type: "text", name: "ville", label: "Ville" },
];
const PAGE = "https://shop.example/checkout";

describe("AutofillBridge", () => {
  it("fills the described form after a message carrying the request's nonce", () => {
    const bridge = new AutofillBridge(() => "n1");
    expect(bridge.start(PAGE, { section: "address", entry: data.addresses[0] })).toContain('"n1"');
    const script = bridge.parse(JSON.stringify({ type: "autofill-fields", nonce: "n1", fields }), PAGE, PAGE);
    expect(script).toContain("12 rue de la Paix");
    expect(script).toContain('"https://shop.example"');
    // One answer per request.
    expect(bridge.parse(JSON.stringify({ type: "autofill-fields", nonce: "n1", fields }), PAGE, PAGE)).toBeNull();
  });

  it("refuses other nonces, other origins and unrelated messages", () => {
    const bridge = new AutofillBridge(() => "n2");
    bridge.start(PAGE, { section: "address", entry: data.addresses[0] });
    expect(bridge.parse("hello", PAGE, PAGE)).toBeUndefined();
    expect(bridge.parse(JSON.stringify({ type: "autofill-fields", nonce: "bad", fields }), PAGE, PAGE)).toBeNull();
    bridge.start(PAGE, { section: "address", entry: data.addresses[0] });
    expect(bridge.parse(JSON.stringify({ type: "autofill-fields", nonce: "n2", fields }), "https://evil.example/", PAGE)).toBeNull();
    // A card never goes into an address form.
    bridge.start(PAGE, { section: "card", entry: data.cards[0] });
    expect(bridge.parse(JSON.stringify({ type: "autofill-fields", nonce: "n2", fields }), PAGE, PAGE)).toBeNull();
  });
});

describe("AutofillStore", () => {
  it("persists in secure-store chunks", async () => {
    const secrets = memoryStore();
    const store = new AutofillStore(secrets);
    await store.load();
    await store.replace(data);
    const reloaded = new AutofillStore(secrets);
    await reloaded.load();
    expect(reloaded.current).toEqual(data);
    await reloaded.remove("card", "c1");
    expect(reloaded.current.cards).toEqual([]);
  });
});
