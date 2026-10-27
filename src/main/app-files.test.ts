import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHROME_PAGE, OVERLAY_PAGE, mimeTypeOf, resolveAppFile } from "./app-files";

const ROOT = join("/opt", "browser", "out", "renderer");

describe("resolveAppFile (audit MEDIUM-2)", () => {
  it("serves the bundle's files", () => {
    expect(resolveAppFile(ROOT, CHROME_PAGE)).toBe(join(ROOT, "index.html"));
    expect(resolveAppFile(ROOT, OVERLAY_PAGE)).toBe(join(ROOT, "overlay.html"));
    expect(resolveAppFile(ROOT, "app://browser/assets/index-abc.js?x=1#y")).toBe(join(ROOT, "assets", "index-abc.js"));
    expect(resolveAppFile(ROOT, "app://browser/")).toBe(join(ROOT, "index.html"));
  });

  it.each([
    "app://browser/../main/index.js",
    "app://browser/assets/../../main/index.js",
    "app://browser/%2e%2e/main/index.js",
    "app://browser/..%2fmain%2findex.js",
    "app://browser/..%5cmain%5cindex.js",
    "app://browser/a%00.html",
    "app://browser/%E0%A4%A",
    "app://other/index.html",
    "app://browser.evil/index.html",
    "file:///etc/passwd",
    "https://browser/index.html",
    "not a url",
  ])("never leaves the bundle for %s", (url) => {
    const file = resolveAppFile(ROOT, url);
    // Either refused, or (dot segments normalized away by the URL parser) still inside the bundle.
    expect(file === null || file.startsWith(ROOT + "/") || file.startsWith(ROOT + "\\")).toBe(true);
    if (/%2f|%5c|%00|%E0|\.\.%/i.test(url) || !url.startsWith("app://browser/")) expect(file).toBeNull();
  });
});

describe("mimeTypeOf", () => {
  it("knows the bundle's types and refuses the rest", () => {
    expect(mimeTypeOf("index.html")).toBe("text/html; charset=utf-8");
    expect(mimeTypeOf("a/b.JS")).toBe("text/javascript; charset=utf-8");
    expect(mimeTypeOf("x.css")).toBe("text/css; charset=utf-8");
    expect(mimeTypeOf("x.woff2")).toBe("font/woff2");
    expect(mimeTypeOf("x.exe")).toBeNull();
    expect(mimeTypeOf("README")).toBeNull();
  });
});
