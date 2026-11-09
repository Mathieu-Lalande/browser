import { describe, expect, it } from "vitest";
import { manifestAction, permissionLabels } from "./extensions";
import { compareVersions, crxDownloadUrl, parseUpdateCheck, updateCheckUrl, webStoreIdFromUrl } from "./webstore";

const ID = "cjpalhdlnbpafiamejdnhcphjbkeiagm";

describe("Chrome Web Store pages", () => {
  it("recognizes detail pages, old and new, and nothing else", () => {
    expect(webStoreIdFromUrl(`https://chromewebstore.google.com/detail/ublock-origin/${ID}`)).toBe(ID);
    expect(webStoreIdFromUrl(`https://chromewebstore.google.com/detail/${ID}?hl=fr`)).toBe(ID);
    expect(webStoreIdFromUrl(`https://chromewebstore.google.com/detail/ublock-origin/${ID}/reviews`)).toBe(ID);
    expect(webStoreIdFromUrl(`https://chrome.google.com/webstore/detail/ublock-origin/${ID}`)).toBe(ID);
    expect(webStoreIdFromUrl(`http://chromewebstore.google.com/detail/x/${ID}`)).toBeNull();
    expect(webStoreIdFromUrl(`https://evil.example/detail/x/${ID}`)).toBeNull();
    expect(webStoreIdFromUrl("https://chromewebstore.google.com/category/extensions")).toBeNull();
    expect(webStoreIdFromUrl("not a url")).toBeNull();
  });

  it("recognizes the test store only when given", () => {
    const url = `http://127.0.0.1:4000/detail/test/${ID}`;
    expect(webStoreIdFromUrl(url)).toBeNull();
    expect(webStoreIdFromUrl(url, "http://127.0.0.1:4000")).toBe(ID);
  });
});

describe("update service", () => {
  it("builds Chrome's download and check URLs", () => {
    expect(crxDownloadUrl(ID, 140)).toBe(
      `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=140&acceptformat=crx2,crx3&x=id%3D${ID}%26uc`,
    );
    expect(updateCheckUrl([{ id: ID, version: "1.2" }, { id: "a".repeat(32), version: "3" }], 140, "http://x/u")).toBe(
      `http://x/u?prodversion=140&acceptformat=crx2,crx3&x=id%3D${ID}%26v%3D1.2%26uc&x=id%3D${"a".repeat(32)}%26v%3D3%26uc`,
    );
  });

  it("reads the latest versions from the XML answer", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
      <daystart elapsed_seconds="1"/>
      <app appid="${ID}" cohort="1::" status="ok"><updatecheck codebase="https://x/y.crx" fp="1" hash_sha256="ab" size="1" status="ok" version="1.62.0"/></app>
      <app appid="${"b".repeat(32)}" status="ok"><updatecheck status="noupdate"/></app>
      <app appid='${"c".repeat(32)}' status='ok'><updatecheck version='2.0' status='ok'/></app>
      <app appid="not-an-id" status="ok"><updatecheck status="ok" version="9"/></app>
    </gupdate>`;
    expect([...parseUpdateCheck(xml)]).toEqual([
      [ID, "1.62.0"],
      ["c".repeat(32), "2.0"],
    ]);
    expect(parseUpdateCheck("<html>error</html>").size).toBe(0);
  });

  it("compares versions like Chrome", () => {
    expect(compareVersions("1.10", "1.9")).toBe(1);
    expect(compareVersions("1.0", "1")).toBe(0);
    expect(compareVersions("1.0.1", "1.1")).toBe(-1);
  });
});

describe("permission warnings", () => {
  it("lists site access first, then the API permissions, in French", () => {
    expect(
      permissionLabels({
        permissions: ["storage", "tabs", "https://b.example/*", "alarms"],
        host_permissions: ["*://*.a.example/*"],
        content_scripts: [{ matches: ["https://c.example/*", "https://d.example/*"] }],
      }),
    ).toEqual(["Lire et modifier vos données sur a.example, b.example, c.example et 1 autre site", "Lire votre historique de navigation"]);
    expect(permissionLabels({ permissions: ["<all_urls>", "proxy", "clipboardWrite"] })).toEqual([
      "Lire et modifier toutes vos données sur tous les sites",
      "Modifier les données copiées dans le presse-papiers",
    ]);
    expect(permissionLabels({ permissions: ["storage", "activeTab"] })).toEqual([]);
    expect(permissionLabels(null)).toEqual([]);
  });

  it("reads the toolbar button of MV3 and MV2 manifests", () => {
    expect(manifestAction({ action: { default_title: "Bloqueur", default_icon: { 16: "i16.png", 32: "/i32.png" }, default_popup: "./popup.html?x" } })).toEqual({
      title: "Bloqueur",
      iconPath: "i32.png",
      popup: "popup.html",
    });
    expect(manifestAction({ browser_action: { default_icon: "icon.png" } })).toEqual({ title: null, iconPath: "icon.png", popup: null });
    expect(manifestAction({ action: { default_popup: "../escape.html" } })?.popup).toBeNull();
    expect(manifestAction({ name: "none" })).toBeNull();
  });
});
