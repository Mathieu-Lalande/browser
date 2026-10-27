import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { equalBytes, fromBase64Url, randomBytesChecked, toBase64Url, utf8Decode, utf8Encode } from "./bytes";
import { deriveKeys, generateSyncKey, open, recordId, seal } from "./crypto";
import { canonicalJson, hashValue } from "./hash";
import { MAX_DRIFT_MS, compareHlc, createClock, decodeHlc, encodeHlc, receive, tick } from "./hlc";
import { decodePairingCode, encodePairingCode, isSyncCredentials, normalizeServerUrl } from "./pairing";

const rng = (n: number) => new Uint8Array(randomBytes(n));

describe("bytes", () => {
  it("encodes UTF-8 like Node, emoji and accents included", () => {
    for (const text of ["", "abc", "Électricité à Noël", "😀 👨‍👩‍👧", "日本語", "\u0000\u007f\u0080߿ࠀ￿"]) {
      expect(Buffer.from(utf8Encode(text)).equals(Buffer.from(text, "utf8"))).toBe(true);
      expect(utf8Decode(utf8Encode(text))).toBe(text);
    }
  });

  it("rejects malformed UTF-8", () => {
    expect(() => utf8Decode(Uint8Array.of(0xc3))).toThrow();
    expect(() => utf8Decode(Uint8Array.of(0xff))).toThrow();
    expect(() => utf8Decode(Uint8Array.of(0xe0, 0x80, 0x80))).toThrow();
  });

  it("round-trips base64url like Node", () => {
    for (let length = 0; length < 40; length++) {
      const bytes = rng(length);
      const text = toBase64Url(bytes);
      expect(text).toBe(Buffer.from(bytes).toString("base64url"));
      expect(equalBytes(fromBase64Url(text), bytes)).toBe(true);
    }
    expect(() => fromBase64Url("ab+c")).toThrow();
  });

  it("refuses a random source that returns zeros or the wrong length", () => {
    expect(() => randomBytesChecked((n) => new Uint8Array(n), 32)).toThrow();
    expect(() => randomBytesChecked(() => new Uint8Array(3), 32)).toThrow();
    expect(randomBytesChecked((n) => randomBytes(n), 24)).toHaveLength(24);
  });
});

describe("hybrid logical clock", () => {
  it("orders local events even when the wall clock goes back", () => {
    let clock = createClock("a");
    const stamps: string[] = [];
    for (const now of [1000, 1000, 999, 2000, 1500]) {
      clock = tick(clock, now);
      stamps.push(encodeHlc(clock));
    }
    expect([...stamps].sort(compareHlc)).toEqual(stamps);
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  it("orders after a received timestamp, and clamps absurd future ones", () => {
    const local = tick(createClock("a"), 1000);
    const remote = { wall: 5000, counter: 3, node: "b" };
    const merged = receive(local, remote, 1000);
    expect(compareHlc(encodeHlc(tick(merged, 1000)), encodeHlc(remote))).toBeGreaterThan(0);
    const future = receive(local, { wall: 1000 + MAX_DRIFT_MS * 10, counter: 0, node: "b" }, 1000);
    expect(future.wall).toBe(1000 + MAX_DRIFT_MS);
  });

  it("breaks ties with the device id, and round-trips its encoding", () => {
    const a = encodeHlc({ wall: 7, counter: 1, node: "aaa" });
    const b = encodeHlc({ wall: 7, counter: 1, node: "bbb" });
    expect(compareHlc(a, b)).toBeLessThan(0);
    expect(decodeHlc(a)).toEqual({ wall: 7, counter: 1, node: "aaa" });
    expect(decodeHlc("nope")).toBeNull();
  });
});

describe("record encryption", () => {
  const keys = deriveKeys(generateSyncKey(rng));

  it("round-trips and uses a fresh nonce each time", () => {
    const rid = recordId(keys, "bookmarks", "b:https://example.com/");
    const a = seal(keys, rng, "bookmarks", rid, '{"x":"Éte 😀"}');
    const b = seal(keys, rng, "bookmarks", rid, '{"x":"Éte 😀"}');
    expect(a).not.toBe(b);
    expect(open(keys, "bookmarks", rid, a)).toBe('{"x":"Éte 😀"}');
  });

  it("binds the ciphertext to its collection and record id, and detects tampering", () => {
    const rid = recordId(keys, "history", "https://a.example/");
    const other = recordId(keys, "history", "https://b.example/");
    const envelope = seal(keys, rng, "history", rid, "secret");
    expect(() => open(keys, "history", other, envelope)).toThrow();
    expect(() => open(keys, "bookmarks", rid, envelope)).toThrow();
    const bytes = fromBase64Url(envelope);
    bytes[bytes.length - 5] ^= 1;
    expect(() => open(keys, "history", rid, toBase64Url(bytes))).toThrow();
    expect(() => open(deriveKeys(generateSyncKey(rng)), "history", rid, envelope)).toThrow();
  });

  it("hides local ids behind a keyed hash", () => {
    const id = recordId(keys, "history", "https://bank.example/");
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(recordId(keys, "history", "https://bank.example/")).toBe(id);
    expect(recordId(deriveKeys(generateSyncKey(rng)), "history", "https://bank.example/")).not.toBe(id);
    expect(recordId(keys, "bookmarks", "https://bank.example/")).not.toBe(id);
  });
});

describe("pairing", () => {
  const credentials = { serverUrl: "https://sync.example.org", accountId: "a".repeat(32), token: "t".repeat(43), syncKey: toBase64Url(rng(32)) };

  it("round-trips a pairing code, whitespace from copy/paste ignored", () => {
    const code = encodePairingCode(credentials);
    expect(decodePairingCode(code)).toEqual(credentials);
    expect(decodePairingCode(`  ${code.slice(0, 20)}\n${code.slice(20)} `)).toEqual(credentials);
    expect(decodePairingCode(code.slice(0, -4))).toBeNull();
    expect(decodePairingCode("hello")).toBeNull();
  });

  it("accepts https servers, and http only on the local network", () => {
    expect(normalizeServerUrl("sync.example.org/")).toBe("https://sync.example.org");
    expect(normalizeServerUrl("https://example.org/sync/")).toBe("https://example.org/sync");
    expect(normalizeServerUrl("http://192.168.1.20:8787")).toBe("http://192.168.1.20:8787");
    expect(normalizeServerUrl("http://127.0.0.1:9000")).toBe("http://127.0.0.1:9000");
    expect(normalizeServerUrl("http://sync.example.org")).toBeNull();
    expect(normalizeServerUrl("https://user:pw@example.org")).toBeNull();
    expect(normalizeServerUrl("ftp://example.org")).toBeNull();
    expect(isSyncCredentials({ ...credentials, syncKey: "short" })).toBe(false);
  });
});

describe("change hashing", () => {
  it("ignores key order but not values", () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
    expect(hashValue({ a: 1, b: 2 })).toBe(hashValue({ b: 2, a: 1 }));
    expect(hashValue({ a: 1 })).not.toBe(hashValue({ a: 2 }));
  });
});
