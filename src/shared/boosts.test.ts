import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  addZap,
  boostCss,
  boostRecord,
  boostsFor,
  defaultMatch,
  filterValue,
  isValidSelector,
  matchesHost,
  mergeBoosts,
  newBoost,
  normalizeMatch,
  pageCss,
  removeZap,
  sanitizeBoost,
  sanitizeBoosts,
  sanitizeFilters,
  sanitizeSyncedBoost,
  scriptAllowed,
  siteBoost,
  validateBoostInput,
  type Boost,
} from "./boosts";

const boost = (overrides: Partial<Boost> = {}): Boost => ({ ...newBoost("b1", "example.com", 1), ...overrides });

describe("match patterns", () => {
  it("normalizes hosts, pasted URLs and wildcard domains", () => {
    expect(normalizeMatch(" Example.COM ")).toBe("example.com");
    expect(normalizeMatch("https://news.example.com/a?b")).toBe("news.example.com");
    expect(normalizeMatch("*.example.com")).toBe("*.example.com");
    expect(normalizeMatch("localhost")).toBe("localhost");
    expect(normalizeMatch("127.0.0.1")).toBe("127.0.0.1");
  });

  it("refuses broad or malformed patterns", () => {
    for (const bad of ["", "*.com", "*", "*example.com", "exa mple.com", "-a.com", "a..com", "example.com/path", "*.*.com", 42, null]) {
      expect(normalizeMatch(bad)).toBeNull();
    }
  });

  it("matches exact hosts, and a domain with its subdomains", () => {
    expect(matchesHost("example.com", "example.com")).toBe(true);
    expect(matchesHost("example.com", "www.example.com")).toBe(false);
    expect(matchesHost("*.example.com", "example.com")).toBe(true);
    expect(matchesHost("*.example.com", "a.b.example.com")).toBe(true);
    expect(matchesHost("*.example.com", "badexample.com")).toBe(false);
  });

  it("finds the boosts of a page, web pages only, most specific last", () => {
    const wide = boost({ id: "w", match: "*.example.com" });
    const exact = boost({ id: "e", match: "news.example.com" });
    const off = boost({ id: "o", match: "news.example.com", enabled: false });
    expect(boostsFor([exact, wide, off], "https://news.example.com/x").map((b) => b.id)).toEqual(["w", "e"]);
    expect(boostsFor([wide], "browser://settings")).toEqual([]);
    expect(boostsFor([wide], "file:///example.com")).toEqual([]);
    expect(siteBoost([wide, off], "https://news.example.com/")?.id).toBe("o");
  });

  it("proposes the whole domain for www hosts", () => {
    expect(defaultMatch("www.example.com")).toBe("*.example.com");
    expect(defaultMatch("docs.example.com")).toBe("docs.example.com");
  });
});

describe("selectors", () => {
  it("accepts generated selectors", () => {
    for (const ok of ["#ad", "div.banner > a:nth-of-type(2)", "#\\31 23", "a[href='x']", "main > section.c:nth-of-type(3)"]) {
      expect(isValidSelector(ok)).toBe(true);
    }
  });

  it("refuses anything that could break out of its rule or hide the page", () => {
    for (const bad of ["a { color: red }", "a;b", "@import x", "a /* c */", "body", "html", "*", "a[x='y]", "a(b", "a\\", "a\nb", " a", "x".repeat(401), 3]) {
      expect(isValidSelector(bad)).toBe(false);
    }
  });

  it("adds and removes zaps without duplicates", () => {
    let b = addZap(boost(), "#ad", 2);
    b = addZap(b, "#ad", 3);
    b = addZap(b, "body", 4);
    expect(b.zaps).toEqual(["#ad"]);
    expect(removeZap(b, "#ad", 5).zaps).toEqual([]);
  });
});

describe("validation", () => {
  it("clamps filters to safe ranges", () => {
    expect(sanitizeFilters({ invert: "yes", grayscale: 500, brightness: 0, contrast: 120.4 })).toEqual({ ...DEFAULT_FILTERS, grayscale: 100, brightness: 50, contrast: 120 });
  });

  it("validates whole boosts", () => {
    expect(sanitizeBoost({ id: "../x", match: "a.com" })).toBeNull();
    expect(sanitizeBoost({ id: "a", match: "*.com" })).toBeNull();
    const parsed = sanitizeBoost({ id: "a", match: "A.com", css: "x".repeat(30_000), zaps: ["#a", "body", "#a"], font: "comic", script: { enabled: 1, code: "x" } });
    expect(parsed).toMatchObject({ name: "a.com", match: "a.com", enabled: true, zaps: ["#a"], font: null, script: { enabled: false, code: "x", allowPrivate: false } });
    expect(parsed?.css.length).toBe(20_000);
    expect(sanitizeBoosts([{ id: "a", match: "a.com" }, { id: "a", match: "b.com" }, null])).toHaveLength(1);
  });

  it("runs scripts only when enabled, and in private pages only when allowed", () => {
    const withScript = boost({ script: { enabled: true, code: "1", allowPrivate: false } });
    expect(scriptAllowed(boost(), false)).toBe(false);
    expect(scriptAllowed(withScript, false)).toBe(true);
    expect(scriptAllowed(withScript, true)).toBe(false);
    expect(scriptAllowed({ ...withScript, script: { ...withScript.script, allowPrivate: true } }, true)).toBe(true);
    expect(scriptAllowed({ ...withScript, enabled: false }, false)).toBe(false);
  });
});

describe("CSS", () => {
  it("is empty for a neutral boost", () => {
    expect(boostCss(boost())).toBe("");
    expect(filterValue(DEFAULT_FILTERS)).toBe("");
  });

  it("puts filters on html, the font, one rule per zap, then the custom CSS", () => {
    const css = boostCss(boost({ filters: { ...DEFAULT_FILTERS, grayscale: 100, contrast: 120 }, font: "serif", zaps: ["#ad", ".promo"], css: "p { color: red }" }));
    const lines = css.split("\n");
    expect(lines[0]).toBe("html { filter: grayscale(100%) contrast(120%) !important; }");
    expect(lines[1]).toContain("font-family: Georgia");
    expect(lines[2]).toBe("#ad { display: none !important; }");
    expect(lines[3]).toBe(".promo { display: none !important; }");
    expect(lines[4]).toBe("p { color: red }");
  });

  it("inverts pictures back on inverted pages", () => {
    expect(boostCss(boost({ filters: { ...DEFAULT_FILTERS, invert: true } }))).toContain("img, video");
  });

  it("combines the boosts of a page", () => {
    const boosts = [boost({ id: "a", css: "a{}" }), boost({ id: "b", match: "*.example.com", css: "b{}" })];
    expect(pageCss(boosts, "https://example.com/")).toBe("b{}\na{}");
    expect(pageCss(boosts, "https://other.com/")).toBe("");
  });
});

describe("sync records", () => {
  it("leaves a disabled script on the device", () => {
    const record = boostRecord(boost({ script: { enabled: false, code: "secret()", allowPrivate: true } }));
    expect(record).not.toHaveProperty("id");
    expect(record.script).toEqual({ enabled: false, code: "", allowPrivate: false });
    expect(boostRecord(boost({ script: { enabled: true, code: "x()", allowPrivate: false } })).script.code).toBe("x()");
  });

  it("validates records and keeps the local disabled script on merge", () => {
    expect(sanitizeSyncedBoost({ match: "*.com" }, "a")).toBeNull();
    expect(sanitizeSyncedBoost({ match: "a.com" }, "bad id")).toBeNull();
    const local = [boost({ id: "a", script: { enabled: false, code: "keep()", allowPrivate: false } }), boost({ id: "gone" })];
    const record = sanitizeSyncedBoost({ ...boostRecord(local[0]), css: "x{}" }, "a")!;
    const merged = mergeBoosts(local, [["a", record], ["new", sanitizeSyncedBoost({ match: "b.com" }, "new")!]], ["gone"]);
    expect(merged.map((b) => b.id)).toEqual(["a", "new"]);
    expect(merged[0]).toMatchObject({ css: "x{}", script: { code: "keep()", enabled: false } });
  });
});

describe("editing", () => {
  it("explains what to fix instead of truncating", () => {
    expect(validateBoostInput({ ...boost(), match: "*.com" }, "b1", 5)).toMatchObject({ ok: false });
    expect(validateBoostInput({ ...boost(), css: "x".repeat(20_001) }, "b1", 5)).toMatchObject({ ok: false, message: expect.stringContaining("CSS") });
    expect(validateBoostInput({ ...boost(), zaps: ["body"] }, "b1", 5)).toMatchObject({ ok: false });
    expect(validateBoostInput({ ...boost(), name: " Mon site " }, "b9", 5)).toMatchObject({ ok: true, boost: { id: "b9", name: "Mon site", updatedAt: 5 } });
  });
});
