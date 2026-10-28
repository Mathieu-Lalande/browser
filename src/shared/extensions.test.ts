import { describe, expect, it } from "vitest";
import { isExtensionId, isSafeRelativePath, localizeMessage, validateManifest } from "./extensions";

describe("validateManifest", () => {
  it("accepts Manifest V2 and V3", () => {
    for (const version of [2, 3]) {
      const check = validateManifest({ manifest_version: version, name: " Bloqueur ", version: "1.2.3.4", description: "Bloque." });
      expect(check).toEqual({
        ok: true,
        manifest: { name: "Bloqueur", version: "1.2.3.4", description: "Bloque.", manifestVersion: version, iconPath: null },
      });
    }
  });

  it("rejects other manifest versions, missing names and bad versions in French", () => {
    expect(validateManifest({ manifest_version: 1, name: "A", version: "1" })).toMatchObject({ ok: false, message: /Manifest V2 et V3/ });
    expect(validateManifest({ name: "A", version: "1" })).toMatchObject({ ok: false });
    expect(validateManifest({ manifest_version: 3, version: "1" })).toMatchObject({ ok: false, message: /nom/ });
    expect(validateManifest({ manifest_version: 3, name: "A", version: "1.0.0.0.0" })).toMatchObject({ ok: false, message: /version/ });
    expect(validateManifest({ manifest_version: 3, name: "A", version: "01.0" })).toMatchObject({ ok: false });
    expect(validateManifest({ manifest_version: 3, name: "A", version: "70000" })).toMatchObject({ ok: false });
    expect(validateManifest({ manifest_version: 3, name: "A" })).toMatchObject({ ok: false });
    expect(validateManifest(null)).toMatchObject({ ok: false, message: /illisible/ });
    expect(validateManifest([])).toMatchObject({ ok: false });
  });

  it("resolves __MSG_ names from the default locale", () => {
    const messages = { appName: { message: "Mon extension" } };
    const check = validateManifest({ manifest_version: 3, name: "__MSG_appname__", version: "1", description: "__MSG_missing__" }, messages);
    expect(check).toMatchObject({ ok: true, manifest: { name: "Mon extension", description: "" } });
    expect(validateManifest({ manifest_version: 3, name: "__MSG_appName__", version: "1" })).toMatchObject({ ok: false });
  });

  it("picks the largest icon up to 128 px, inside the extension only", () => {
    const icons = { "16": "icons/16.png", "48": "./icons/48.png", "256": "icons/256.png" };
    expect(validateManifest({ manifest_version: 3, name: "A", version: "1", icons })).toMatchObject({ manifest: { iconPath: "icons/48.png" } });
    expect(validateManifest({ manifest_version: 3, name: "A", version: "1", icons: { "256": "big.png" } })).toMatchObject({
      manifest: { iconPath: "big.png" },
    });
    expect(validateManifest({ manifest_version: 3, name: "A", version: "1", icons: { "16": "../../etc/x.png" } })).toMatchObject({
      manifest: { iconPath: null },
    });
  });
});

describe("helpers", () => {
  it("checks relative paths", () => {
    expect(isSafeRelativePath("a/b.js")).toBe(true);
    for (const bad of ["", "/a", "../a", "a/../../b", "a\\b", "C:/x", "a//b"]) expect(isSafeRelativePath(bad)).toBe(false);
  });

  it("checks ids and plain strings", () => {
    expect(isExtensionId("abcdefghijklmnopabcdefghijklmnop")).toBe(true);
    expect(isExtensionId("abcdefghijklmnopabcdefghijklmnoq")).toBe(false);
    expect(isExtensionId(42)).toBe(false);
    expect(localizeMessage("Plain", null)).toBe("Plain");
  });
});
