import { describe, expect, it } from "vitest";
import {
  captureOutcome,
  editEntry,
  entriesFor,
  isPasswordEdit,
  markUsed,
  originLabel,
  passwordOrigin,
  passwordsToCsv,
  sanitizeCapture,
  sanitizeVault,
  saveCapture,
  searchPasswords,
  setNever,
  summarize,
  type PasswordVault,
} from "./passwords";

const capture = (overrides: Partial<{ origin: string; username: string; password: string }> = {}) => ({
  origin: "https://example.com",
  username: "alice",
  password: "s3cret",
  ...overrides,
});

const empty = (): PasswordVault => ({ entries: [], never: [] });

describe("password origins", () => {
  it("match exact http(s) origins only", () => {
    expect(passwordOrigin("https://Example.com/login?x=1#a")).toBe("https://example.com");
    expect(passwordOrigin("http://127.0.0.1:8080/form")).toBe("http://127.0.0.1:8080");
    for (const url of ["file:///etc/passwd", "browser://settings", "data:text/html,x", "about:blank", "javascript:alert(1)", "nope"]) {
      expect(passwordOrigin(url)).toBeNull();
    }
  });

  it("never share an entry between sub-domains, schemes or ports", () => {
    const vault = saveCapture(empty(), capture(), 1, "a");
    expect(entriesFor(vault, "https://example.com")).toHaveLength(1);
    for (const other of ["https://login.example.com", "http://example.com", "https://example.com:8443", "https://example.co"]) {
      expect(entriesFor(vault, other)).toEqual([]);
    }
  });

  it("label sites by host, flagging http", () => {
    expect(originLabel("https://example.com")).toBe("example.com");
    expect(originLabel("http://127.0.0.1:3000")).toBe("127.0.0.1:3000 (http)");
  });
});

describe("captures", () => {
  it("validate untrusted page input", () => {
    expect(sanitizeCapture(capture({ username: "  bob\u0000 " }))).toEqual(capture({ username: "bob" }));
    expect(sanitizeCapture(capture({ password: "" }))).toBeNull();
    expect(sanitizeCapture(capture({ origin: "file://" }))).toBeNull();
    expect(sanitizeCapture(capture({ origin: "https://example.com/path" }))).toBeNull();
    expect(sanitizeCapture(capture({ password: "x".repeat(2000) }))).toBeNull();
    expect(sanitizeCapture(null)).toBeNull();
  });

  it("are new, an update, the same, or for a never-saved site", () => {
    let vault = empty();
    expect(captureOutcome(vault, capture())).toBe("new");
    vault = saveCapture(vault, capture(), 10, "a");
    expect(captureOutcome(vault, capture())).toBe("same");
    expect(captureOutcome(vault, capture({ password: "other" }))).toBe("update");
    expect(captureOutcome(vault, capture({ username: "bob" }))).toBe("new");
    vault = setNever(vault, "https://example.com", true);
    expect(captureOutcome(vault, capture({ username: "bob" }))).toBe("never");
  });

  it("update the account's password instead of adding a second entry", () => {
    let vault = saveCapture(empty(), capture(), 10, "a");
    vault = saveCapture(vault, capture({ password: "new" }), 20, "b");
    expect(vault.entries).toEqual([{ id: "a", ...capture({ password: "new" }), createdAt: 10, updatedAt: 20, lastUsedAt: null }]);
  });

  it("take the site off the never list when saved", () => {
    const vault = saveCapture(setNever(empty(), "https://example.com", true), capture(), 1, "a");
    expect(vault.never).toEqual([]);
  });
});

describe("entries", () => {
  it("are listed most recently used first", () => {
    let vault = saveCapture(empty(), capture(), 10, "a");
    vault = saveCapture(vault, capture({ username: "bob" }), 20, "b");
    expect(entriesFor(vault, "https://example.com").map((entry) => entry.id)).toEqual(["b", "a"]);
    vault = markUsed(vault, "a", 30);
    expect(entriesFor(vault, "https://example.com").map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("edit username and password, refusing a duplicate account", () => {
    let vault = saveCapture(empty(), capture(), 10, "a");
    vault = saveCapture(vault, capture({ username: "bob" }), 10, "b");
    expect(editEntry(vault, "a", { username: "bob" }, 20)).toEqual({ error: expect.stringContaining("déjà enregistré") });
    expect(editEntry(vault, "zzz", { username: "x" }, 20)).toEqual({ error: expect.any(String) });
    const result = editEntry(vault, "a", { username: "carol", password: "pw2" }, 20);
    expect("vault" in result && result.vault.entries[0]).toMatchObject({ username: "carol", password: "pw2", updatedAt: 20 });
    expect(isPasswordEdit({ password: "" })).toBe(false);
    expect(isPasswordEdit({ username: "x", password: "y" })).toBe(true);
  });

  it("summaries never carry the password", () => {
    const [entry] = saveCapture(empty(), capture(), 1, "a").entries;
    expect(summarize(entry)).not.toHaveProperty("password");
  });

  it("search by site or username, sorted by site", () => {
    let vault = saveCapture(empty(), capture({ origin: "https://zeta.org" }), 1, "a");
    vault = saveCapture(vault, capture({ origin: "https://alpha.net", username: "bob" }), 1, "b");
    const list = vault.entries.map(summarize);
    expect(searchPasswords(list, "").map((entry) => entry.id)).toEqual(["b", "a"]);
    expect(searchPasswords(list, "ZETA").map((entry) => entry.id)).toEqual(["a"]);
    expect(searchPasswords(list, "bob").map((entry) => entry.id)).toEqual(["b"]);
  });
});

describe("stored vault", () => {
  it("drops invalid entries, duplicates and bad never-list origins", () => {
    const good = { id: "a", origin: "https://example.com", username: "u", password: "p", createdAt: 1, updatedAt: 2, lastUsedAt: null };
    const vault = sanitizeVault({
      entries: [good, { ...good, id: "b" }, { ...good, id: "c", origin: "file://x" }, { ...good, id: "bad id!" }, { ...good, id: "d", username: "v", lastUsedAt: "x" }],
      never: ["https://a.com", "https://a.com", "nope", 3],
    });
    expect(vault.entries.map((entry) => entry.id)).toEqual(["a", "d"]);
    expect(vault.entries[1].lastUsedAt).toBeNull();
    expect(vault.never).toEqual(["https://a.com"]);
    expect(sanitizeVault("garbage")).toEqual({ entries: [], never: [] });
  });
});

describe("CSV export", () => {
  it("writes Chrome's columns, every cell quoted and escaped", () => {
    let vault = saveCapture(empty(), capture({ username: 'a"b', password: "p,w\nx" }), 1, "a");
    vault = saveCapture(vault, capture({ origin: "http://127.0.0.1:8080", username: "", password: "=1+1" }), 1, "b");
    expect(passwordsToCsv(vault.entries)).toBe(
      'name,url,username,password\r\n"127.0.0.1:8080","http://127.0.0.1:8080","","=1+1"\r\n"example.com","https://example.com","a""b","p,w\nx"\r\n',
    );
  });
});
