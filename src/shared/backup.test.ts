import { describe, expect, it } from "vitest";
import { backupFileName, decodeBackup, encodeBackup, openSecret, summarizeBackup, WrongPassphraseError } from "./backup";

const rng = (length: number) => Uint8Array.from({ length }, (_, i) => (i * 7 + 3) & 255);
const kdf = { n: 2 ** 4, r: 8, p: 1 };

describe("backup codec", () => {
  const contents = { settings: { appearance: {} }, bookmarks: { bookmarks: [{ url: "https://a.example/" }], folders: [] }, history: [{}, {}] };

  it("round-trips the plain sections without passwords", () => {
    const file = decodeBackup(encodeBackup({ contents, profileName: "Personnel", createdAt: 5 }))!;
    expect(file.contents).toEqual(contents);
    expect(file.passwords).toBeUndefined();
    expect(summarizeBackup(file)).toEqual({ createdAt: 5, profileName: "Personnel", counts: { settings: 1, bookmarks: 1, history: 2 }, hasPasswords: false });
  });

  it("seals passwords with the passphrase, and refuses a wrong one", () => {
    const vault = { entries: [{ id: "x", password: "s3cret" }], never: [] };
    const text = encodeBackup({ contents, profileName: "P", createdAt: 1, passwords: { vault, passphrase: "correct horse", rng, kdf } });
    expect(text).not.toContain("s3cret");
    const file = decodeBackup(text)!;
    expect(JSON.parse(openSecret(file.passwords!, "correct horse"))).toEqual(vault);
    expect(() => openSecret(file.passwords!, "wrong horse!")).toThrow(WrongPassphraseError);
    expect(() => encodeBackup({ contents, profileName: "P", createdAt: 1, passwords: { vault, passphrase: "short", rng, kdf } })).toThrow();
  });

  it("rejects what is not a backup", () => {
    expect(decodeBackup("nope")).toBeNull();
    expect(decodeBackup(JSON.stringify({ format: "browser-backup", version: 99, contents: {} }))).toBeNull();
    expect(decodeBackup(JSON.stringify({ format: "other", version: 1, contents: {} }))).toBeNull();
    expect(Object.keys(decodeBackup(JSON.stringify({ format: "browser-backup", version: 1, contents: { cookies: [1], history: [] } }))!.contents)).toEqual(["history"]);
  });

  it("names files", () => {
    expect(backupFileName("Mon profil", Date.UTC(2026, 10, 3))).toBe("Browser-Mon-profil-2026-11-03.browserbackup");
  });
});
