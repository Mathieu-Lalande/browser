import { describe, expect, it } from "vitest";
import { crx3, testKey, zipOf } from "../../../tests/crx-pack";
import { extensionIdFromKey, verifyCrx } from "./crx";
import { readZip } from "./unpack";
import { WebStoreClient } from "./webstore";

const key = testKey();
const other = testKey();
const zip = zipOf({ "manifest.json": JSON.stringify({ manifest_version: 3, name: "Test", version: "1.0" }) });

describe("CRX3 store packages", () => {
  it("computes Chrome's id from a public key", () => {
    // SHA-256 of nothing is e3b0c442…: hex digits 0–f become letters a–p.
    expect(extensionIdFromKey(new Uint8Array())).toBe("odlameecjipmbmbejkplpemijjgpljce");
    expect(extensionIdFromKey(key.publicKey)).toBe(key.id);
    expect(key.id).toMatch(/^[a-p]{32}$/);
  });

  it("accepts a package signed by the key of the requested id", () => {
    const verified = verifyCrx(crx3(zip, key), key.id);
    expect(readZip(verified.zip).map((entry) => entry.path)).toEqual(["manifest.json"]);
    expect(verified.publicKey.equals(key.publicKey)).toBe(true);
  });

  it("refuses another extension, a forged id, a broken signature and old formats", () => {
    expect(() => verifyCrx(crx3(zip, key), other.id)).toThrow(/ne correspond pas/);
    // Claims the other id, but no key of the package hashes to it.
    expect(() => verifyCrx(crx3(zip, key, { claimedId: other.id }), other.id)).toThrow(/Aucune clé/);
    expect(() => verifyCrx(crx3(zip, key, { tamper: true }), key.id)).toThrow(/signature/);
    const crx2 = Buffer.concat([Buffer.from("Cr24", "latin1"), Buffer.from([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), zip]);
    expect(() => verifyCrx(crx2, key.id)).toThrow(/CRX3/);
    expect(() => verifyCrx(Buffer.from("<html>"), key.id)).toThrow(/\.crx/);
  });
});

describe("WebStoreClient", () => {
  const response = (body: ConstructorParameters<typeof Response>[0], status = 200) => new Response(body, { status });

  it("downloads through the update endpoint and verifies the package", async () => {
    const asked: string[] = [];
    const client = new WebStoreClient({
      chromeMajor: 140,
      testOrigin: "http://store.test",
      fetch: async (url) => {
        asked.push(url);
        return response(new Uint8Array(crx3(zip, key)));
      },
    });
    await expect(client.download(key.id)).resolves.toMatchObject({ publicKey: key.publicKey });
    expect(asked).toEqual([`http://store.test/service/update2/crx?response=redirect&prodversion=140&acceptformat=crx2,crx3&x=id%3D${key.id}%26uc`]);
  });

  it("explains a missing package or an unreachable store, and reads versions", async () => {
    const missing = new WebStoreClient({ chromeMajor: 140, fetch: async () => response(null, 204) });
    await expect(missing.download(key.id)).rejects.toThrow(/pas disponible/);
    const offline = new WebStoreClient({ chromeMajor: 140, fetch: async () => Promise.reject(new Error("offline")) });
    await expect(offline.download(key.id)).rejects.toThrow(/joindre/);
    const xml = `<gupdate><app appid="${key.id}"><updatecheck status="ok" version="1.1"/></app></gupdate>`;
    const versions = new WebStoreClient({ chromeMajor: 140, fetch: async () => response(xml) });
    await expect(versions.latestVersions([{ id: key.id, version: "1.0" }])).resolves.toEqual(new Map([[key.id, "1.1"]]));
  });
});
