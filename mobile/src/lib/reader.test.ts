import { sanitizeReaderArticle } from "@shared/reader";
import { sanitizeSettings } from "@shared/settings";
import { READER_MESSAGE, desktopUserAgent, parseReaderMessage, readerBlocks, readerScript } from "./reader";

const URL_ = "https://news.example/a";
const el = (tag: string, children: unknown[] = [], extra: Record<string, unknown> = {}) => ({ tag, children, ...extra });
const message = (token: string, article: unknown) => JSON.stringify({ type: READER_MESSAGE, token, article });

describe("reader messages", () => {
  const article = { title: "Titre", content: [el("p", ["Bonjour ", el("script", ["alert(1)"]), el("a", ["lien"], { href: "javascript:alert(1)" })])] };

  it("accepts only the pending request's answer, validated against the tab's URL", () => {
    const parsed = parseReaderMessage(message("t1", article), "t1", URL_);
    expect(parsed?.url).toBe(URL_);
    expect(parsed?.content).toEqual([{ tag: "p", children: ["Bonjour lien"] }]);
    expect(parseReaderMessage(message("other", article), "t1", URL_)).toBeNull();
    expect(parseReaderMessage(message("t1", article), null, URL_)).toBeNull();
    expect(parseReaderMessage(message("t1", article), "t1", "file:///etc/passwd")).toBeNull();
  });

  it("leaves other bridge messages alone", () => {
    expect(parseReaderMessage(JSON.stringify({ type: "link-menu" }), "t1", URL_)).toBeUndefined();
    expect(parseReaderMessage(`not json ${READER_MESSAGE}`, "t1", URL_)).toBeUndefined();
    expect(parseReaderMessage(`"${READER_MESSAGE}"`.padEnd(5_000_000, " "), "t1", URL_)).toBeUndefined();
  });

  it("injects Readability with the token", () => {
    const script = readerScript("abc");
    expect(script).toContain("function Readability(");
    expect(script).toContain('"abc"');
    expect(script.trim().endsWith("true;")).toBe(true);
  });

  it("asks for the desktop site with a desktop user agent", () => {
    expect(desktopUserAgent("ios")).toContain("Macintosh");
    expect(desktopUserAgent("android")).not.toMatch(/Mobile|Android/);
  });
});

describe("readerBlocks", () => {
  const blocks = (content: unknown[]) => readerBlocks(sanitizeReaderArticle({ content }, URL_)!.content);

  it("turns the tree into native blocks with inline styles", () => {
    expect(
      blocks([
        el("h2", ["Titre"]),
        el("p", ["Du ", el("strong", ["gras"]), ", de l'", el("em", ["italique"]), " et un ", el("a", ["lien"], { href: "https://x.example/" }), "."]),
        el("blockquote", [el("p", ["Citation"])]),
        el("pre", ["a\n  b"]),
        el("hr"),
        el("img", [], { src: "https://img.example/1.png", alt: "Une photo" }),
      ]),
    ).toEqual([
      { kind: "heading", level: 2, spans: [{ text: "Titre" }] },
      {
        kind: "paragraph",
        spans: [
          { text: "Du " },
          { bold: true, text: "gras" },
          { text: ", de l'" },
          { italic: true, text: "italique" },
          { text: " et un " },
          { href: "https://x.example/", text: "lien" },
          { text: "." },
        ],
      },
      { kind: "quote", spans: [{ text: "Citation" }] },
      { kind: "pre", text: "a\n  b" },
      { kind: "rule" },
      { kind: "caption", spans: [{ italic: true, text: "Une photo" }] },
    ]);
  });

  it("numbers ordered lists and nests lists", () => {
    expect(blocks([el("ol", [el("li", ["un"]), el("li", [el("p", ["deux"]), el("ul", [el("li", ["sous"])])])])])).toEqual([
      { kind: "item", marker: "1.", depth: 0, spans: [{ text: "un" }] },
      { kind: "item", marker: "2.", depth: 0, spans: [{ text: "deux" }] },
      { kind: "item", marker: "•", depth: 1, spans: [{ text: "sous" }] },
    ]);
  });

  it("reuses the shared reader settings", () => {
    expect(sanitizeSettings({ reader: { size: 40, theme: "sepia" } }).reader).toMatchObject({ size: 28, theme: "sepia" });
  });
});
