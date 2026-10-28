import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error: plain ESM script without types.
import { OUTPUT, generate } from "../../scripts/gen-readability.mjs";
import {
  READER_EXTRACT_SCRIPT,
  READER_LIMITS,
  countWords,
  mapReaderImages,
  readerColors,
  readerImageSources,
  readerText,
  readingMinutes,
  sanitizeReaderArticle,
  type ReaderElement,
} from "./reader";

const URL_ = "https://news.example/article";
const article = (content: unknown[], extra: Record<string, unknown> = {}) => sanitizeReaderArticle({ title: "Titre", content, ...extra }, URL_);
const el = (tag: string, children: unknown[] = [], extra: Record<string, unknown> = {}) => ({ tag, children, ...extra });

describe("sanitizeReaderArticle", () => {
  it("keeps allowed tags and text, nothing else", () => {
    const result = article([el("p", ["Bonjour ", el("strong", ["le monde"])], { onclick: "alert(1)", style: "x", class: "y" })]);
    expect(result?.content).toEqual([{ tag: "p", children: ["Bonjour ", { tag: "strong", children: ["le monde"] }] }]);
    expect(result?.title).toBe("Titre");
    expect(result?.url).toBe(URL_);
  });

  it("drops scripts, styles, frames and forms with their content", () => {
    const result = article([
      el("p", ["texte"]),
      el("script", ["alert(1)"]),
      el("style", ["p{}"]),
      el("iframe", [], { src: "https://evil.example/" }),
      el("svg", [el("script", ["x"])]),
      el("form", [el("input")]),
    ]);
    expect(result?.content).toEqual([{ tag: "p", children: ["texte"] }]);
    expect(readerText(result!.content)).not.toContain("alert");
  });

  it("unwraps unknown tags, renames known ones", () => {
    const result = article([el("span", [el("b", ["gras"]), " ", el("i", ["it"]), el("custom-thing", [" libre"])]), el("h1", ["T"])]);
    expect(result?.content).toEqual([{ tag: "strong", children: ["gras"] }, " ", { tag: "em", children: ["it"] }, " libre", { tag: "h2", children: ["T"] }]);
  });

  it("keeps only http(s) links and images", () => {
    const result = article([
      el("p", [
        el("a", ["ok"], { href: "https://example.com/a" }),
        el("a", ["js"], { href: "javascript:alert(1)" }),
        el("a", ["data"], { href: "data:text/html,<b>x</b>" }),
        el("a", ["file"], { href: "file:///etc/passwd" }),
        el("a", ["app"], { href: "app://browser/index.html" }),
      ]),
      el("img", [], { src: "https://img.example/a.png", alt: "Une image" }),
      el("img", [], { src: "javascript:alert(1)", alt: "mauvaise" }),
      el("img", [], { src: "data:image/svg+xml,<svg onload=alert(1)>" }),
    ]);
    const p = result!.content[0] as ReaderElement;
    expect(p.children).toEqual([{ tag: "a", children: ["ok"], href: "https://example.com/a" }, "jsdatafileapp"]);
    expect(readerImageSources(result!.content)).toEqual(["https://img.example/a.png"]);
    // A refused image keeps its description as text.
    expect(readerText(result!.content)).toContain("mauvaise");
  });

  it("collapses whitespace except in pre, and strips control characters", () => {
    const result = article([el("p", ["a \n\t b\u0000"]), el("pre", ["line 1\n  line 2"])]);
    expect(result?.content).toEqual([{ tag: "p", children: ["a b"] }, { tag: "pre", children: ["line 1\n  line 2"] }]);
  });

  it("bounds depth, size and images", () => {
    let deep: unknown = "fond";
    for (let i = 0; i < 200; i++) deep = el("div", [deep]);
    const nested = article([deep]);
    expect(readerText(nested!.content)).toBe("fond");
    const huge = article(Array.from({ length: READER_LIMITS.nodes * 2 }, () => el("p", ["mot"])));
    expect(huge!.content.length).toBeLessThanOrEqual(READER_LIMITS.nodes);
    const images = article([el("p", ["x"]), ...Array.from({ length: 100 }, (_, i) => el("img", [], { src: `https://img.example/${i}.png` }))]);
    expect(readerImageSources(images!.content)).toHaveLength(READER_LIMITS.images);
  });

  it("refuses non-objects, empty articles and non-web pages", () => {
    expect(sanitizeReaderArticle(null, URL_)).toBeNull();
    expect(sanitizeReaderArticle("<p>x</p>", URL_)).toBeNull();
    expect(article([])).toBeNull();
    expect(article([el("p", ["   "])])).toBeNull();
    expect(sanitizeReaderArticle({ content: ["texte"] }, "file:///etc/passwd")).toBeNull();
  });

  it("cleans metadata and estimates the reading time", () => {
    const words = Array.from({ length: 690 }, () => "mot").join(" ");
    const result = article([el("p", [words])], { title: "  Un\n titre ", byline: 42, siteName: "Site", lang: "fr-FR", dir: "sideways" });
    expect(result).toMatchObject({ title: "Un titre", byline: null, siteName: "Site", lang: "fr-FR", dir: null, words: 690, minutes: 3 });
    expect(article([el("p", ["x"])], { lang: "fr\"><script>" })?.lang).toBeNull();
  });
});

describe("reader helpers", () => {
  it("counts words and minutes", () => {
    expect(countWords("L'été, c'est 42 jours — non ?")).toBe(5);
    expect(readingMinutes(0)).toBe(1);
    expect(readingMinutes(2300)).toBe(10);
  });

  it("swaps or drops images", () => {
    const content = article([el("p", ["x"]), el("img", [], { src: "https://a.example/1.png" }), el("img", [], { src: "https://a.example/2.png" })])!.content;
    const mapped = mapReaderImages(content, (src) => (src.endsWith("1.png") ? "data:image/png;base64,AA==" : null));
    expect(readerImageSources(mapped)).toEqual(["data:image/png;base64,AA=="]);
  });

  it("follows the app theme for auto", () => {
    expect(readerColors("auto", true)).toEqual(readerColors("dark", false));
    expect(readerColors("auto", false).background).toBe("#ffffff");
    expect(readerColors("sepia", true).background).toBe("#f4ecd8");
  });

  it("ships Readability inside the page script, in sync with the installed package", () => {
    expect(READER_EXTRACT_SCRIPT).toContain("function Readability(");
    expect(readFileSync(OUTPUT, "utf8")).toBe(generate());
  });
});
