import { CHUNK_SIZE, PasswordStore, loadVault, parsePasswordMessage, passwordFillScript, saveVault, type SecretStore } from "./passwords";

/** In-memory stand-in for expo-secure-store. */
function memoryStore(): SecretStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItemAsync: async (key) => data.get(key) ?? null,
    setItemAsync: async (key, value) => void data.set(key, value),
    deleteItemAsync: async (key) => void data.delete(key),
  };
}

const capture = { origin: "https://example.com", username: "alice", password: "s3cret" };

describe("password store", () => {
  it("saves, reloads and updates an account", async () => {
    const secrets = memoryStore();
    let clock = 10;
    let ids = 0;
    const store = new PasswordStore(secrets, undefined, () => clock, () => `id${++ids}`);
    await store.load();
    expect(store.outcome(capture)).toBe("new");
    await store.save(capture);
    expect(store.forUrl("https://example.com/login")).toHaveLength(1);
    expect(store.forUrl("https://sub.example.com/")).toEqual([]);

    const reloaded = new PasswordStore(secrets);
    await reloaded.load();
    expect(reloaded.current.entries).toEqual([{ id: "id1", ...capture, createdAt: 10, updatedAt: 10, lastUsedAt: null }]);
    expect(reloaded.outcome(capture)).toBe("same");

    clock = 20;
    await store.save({ ...capture, password: "new" });
    expect(store.current.entries).toHaveLength(1);
    expect(store.current.entries[0]).toMatchObject({ password: "new", updatedAt: 20 });
    await store.used("id1");
    expect(store.current.entries[0].lastUsedAt).toBe(20);
  });

  it("remembers never-saved sites and removals", async () => {
    const store = new PasswordStore(memoryStore());
    await store.save(capture);
    await store.never("https://other.org");
    expect(store.outcome({ ...capture, origin: "https://other.org" })).toBe("never");
    await store.removeNever("https://other.org");
    expect(store.current.never).toEqual([]);
    await store.remove(store.current.entries[0].id);
    expect(store.current.entries).toEqual([]);
  });

  it("notifies listeners on changes", async () => {
    const store = new PasswordStore(memoryStore());
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);
    await store.save(capture);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});

describe("secure-store chunks", () => {
  it("split large vaults and drop stale chunks when they shrink", async () => {
    const secrets = memoryStore();
    const entries = Array.from({ length: 40 }, (_, index) => ({
      id: `e${index}`,
      origin: `https://site${index}.example`,
      username: `user${index}`,
      password: "x".repeat(200),
      createdAt: 1,
      updatedAt: 1,
      lastUsedAt: null,
    }));
    await saveVault(secrets, { entries, never: [] });
    const count = Number(secrets.data.get("passwords.n"));
    expect(count).toBeGreaterThan(1);
    for (const [key, value] of secrets.data) if (key !== "passwords.n") expect(value.length).toBeLessThanOrEqual(CHUNK_SIZE);
    expect((await loadVault(secrets)).entries).toHaveLength(40);

    await saveVault(secrets, { entries: entries.slice(0, 1), never: [] });
    expect(secrets.data.get("passwords.n")).toBe("1");
    expect(secrets.data.has("passwords.1")).toBe(false);
    expect((await loadVault(secrets)).entries).toHaveLength(1);
  });

  it("start empty on missing or damaged data", async () => {
    const secrets = memoryStore();
    expect(await loadVault(secrets)).toEqual({ entries: [], never: [] });
    secrets.data.set("passwords.n", "2");
    secrets.data.set("passwords.0", "{");
    expect(await loadVault(secrets)).toEqual({ entries: [], never: [] });
  });
});

describe("WebView bridge", () => {
  const message = (value: object) => JSON.stringify({ type: "password-capture", ...value });

  it("takes the origin from the tab, never from the page", () => {
    expect(parsePasswordMessage(message({ username: " bob ", password: "pw", origin: "https://bank.example" }), "https://example.com/login")).toEqual({
      origin: "https://example.com",
      username: "bob",
      password: "pw",
    });
  });

  it("refuses malformed messages and non-web pages", () => {
    expect(parsePasswordMessage(message({ username: "a", password: "" }), "https://example.com")).toBeNull();
    expect(parsePasswordMessage(message({ username: 1, password: "pw" }), "https://example.com")).toBeNull();
    expect(parsePasswordMessage(message({ username: "a", password: "pw" }), "about:blank")).toBeNull();
    expect(parsePasswordMessage(JSON.stringify({ type: "link-menu", href: "https://x" }), "https://example.com")).toBeNull();
    expect(parsePasswordMessage("not json", "https://example.com")).toBeNull();
  });

  it("fills only on the entry's origin, with escaped values", () => {
    const script = passwordFillScript({ origin: "https://example.com", username: 'a"b', password: "</script>" });
    expect(script).toContain('if(location.origin!==origin)return;');
    expect(script).toContain(JSON.stringify('a"b'));
  });
});
