import { describe, expect, it } from "vitest";
import {
  addHighlight,
  annotatedSites,
  annotationRecords,
  annotationUrl,
  annotationsToJson,
  annotationsToMarkdown,
  emptyAnnotations,
  mergeAnnotations,
  removeHighlight,
  removePage,
  sanitizeAnnotations,
  sanitizeHighlightPatch,
  sanitizeQuote,
  sanitizeSyncedAnnotation,
  setPageNote,
  updateHighlight,
  type AnnotationsData,
  type TextQuote,
} from ".";
import { ANCHOR_CORE, ANNOTATOR_FACTORY, highlightCss } from "./page-script";

// --- A minimal DOM: just what `collect` walks (the page script runs in real pages in the e2e tests).

interface FakeNode {
  nodeType: number;
  nodeValue?: string;
  localName?: string;
  firstChild: FakeNode | null;
  nextSibling: FakeNode | null;
  hasAttribute?(name: string): boolean;
}

const text = (value: string): FakeNode => ({ nodeType: 3, nodeValue: value, firstChild: null, nextSibling: null });
function h(name: string, attrs: Record<string, string> | null, ...children: (FakeNode | string)[]): FakeNode {
  const nodes = children.map((child) => (typeof child === "string" ? text(child) : child));
  nodes.forEach((node, index) => (node.nextSibling = nodes[index + 1] ?? null));
  return { nodeType: 1, localName: name, firstChild: nodes[0] ?? null, nextSibling: null, hasAttribute: (attr) => !!attrs && attr in attrs };
}

interface Located {
  start: number;
  end: number;
  errors: number;
}
const core = new Function(`${ANCHOR_CORE}\nreturn { collect, describe, locate };`)() as {
  collect(root: FakeNode): { text: string };
  describe(text: string, start: number, end: number, context: number): TextQuote | null;
  locate(text: string, quote: TextQuote, fuzzy: boolean): Located | null;
};

/** The quote of `exact` (its `occurrence`-th appearance) in a normalized text. */
function quoteOf(source: string, exact: string, occurrence = 0): TextQuote {
  let at = -1;
  for (let i = 0; i <= occurrence; i++) at = source.indexOf(exact, at + 1);
  return core.describe(source, at, at + exact.length, 32)!;
}
const found = (source: string, hit: Located | null) => (hit ? source.slice(hit.start, hit.end) : null);

describe("page text", () => {
  it("collapses whitespace, separates blocks and skips scripts, styles, fields and hidden content", () => {
    const page = h(
      "body",
      null,
      h("h1", null, "  Le   titre\n"),
      h("p", null, "Un renard ", h("b", null, "brun"), " saute.", h("script", null, "var secret = 1;")),
      h("style", null, "p{color:red}"),
      h("div", { hidden: "" }, "caché"),
      h("textarea", null, "champ"),
      h("ul", null, h("li", null, "un"), "\n  ", h("li", null, "deux")),
    );
    expect(core.collect(page).text).toBe("Le titre Un renard brun saute. un deux ");
  });

  it("describes a selection with its context, trimmed", () => {
    const source = "Le titre Un renard brun saute. un deux";
    expect(core.describe(source, 11, 24, 6)).toEqual({ exact: "renard brun", prefix: "re Un ", suffix: " saute", start: 12 });
    expect(core.describe(source, 8, 9, 6)).toBeNull();
  });
});

describe("anchoring", () => {
  const page = "Le chat dort. Le chat mange. Le chat dort encore, puis le chat joue dans le jardin avec une balle rouge.";

  it("finds the exact quote, choosing between repeats by context then position", () => {
    for (const occurrence of [0, 1, 2, 3]) {
      const quote = quoteOf(page, "chat", occurrence);
      const hit = core.locate(page, quote, false)!;
      expect(hit.start).toBe(quote.start);
    }
    // Same context twice: the position hint decides.
    const twice = "x a b x a b";
    const second = { exact: "a", prefix: "x ", suffix: " b", start: 8 };
    expect(core.locate(twice, second, false)!.start).toBe(8);
  });

  it("keeps finding a moved quote by its context", () => {
    const quote = quoteOf(page, "chat dort", 1);
    const moved = `Nouveau paragraphe en tête. ${page}`;
    expect(core.locate(moved, quote, false)!.start).toBe(moved.indexOf("chat dort encore"));
  });

  it("falls back to an approximate match when the text changed a little", () => {
    const quote = quoteOf(page, "joue dans le jardin avec une balle");
    const edited = page.replace("joue dans le jardin", "joue dans son jardin");
    expect(core.locate(edited, quote, false)).toBeNull();
    expect(found(edited, core.locate(edited, quote, true))).toBe("joue dans son jardin avec une balle");
  });

  it("matches long quotes approximately by head and tail", () => {
    const long = "Ceci est une longue phrase qui sert de citation, avec assez de mots pour dépasser soixante-quatre caractères sans peine.";
    const quote = { exact: long, prefix: "Avant. ", suffix: " Après.", start: 7 };
    const edited = `Avant. ${long.replace("assez de mots", "suffisamment de mots")} Après.`;
    const hit = core.locate(edited, quote, true)!;
    expect(found(edited, hit)).toBe(long.replace("assez de mots", "suffisamment de mots"));
  });

  it("gives up when the text is gone", () => {
    const quote = quoteOf(page, "balle rouge");
    expect(core.locate("Une page complètement différente, sans rapport.", quote, true)).toBeNull();
  });

  it("finds a quote spread over inline elements and odd whitespace", () => {
    const before = core.collect(h("body", null, h("p", null, "Le ", h("em", null, "renard"), " brun"))).text;
    const quote = quoteOf(before, "renard brun");
    const after = core.collect(h("body", null, h("p", null, "Le\n  ", h("a", null, h("span", null, "ren"), "ard"), "\t brun et vif"))).text;
    expect(found(after, core.locate(after, quote, false))).toBe("renard brun");
  });

  it("builds a page script that evaluates (ES2018, no imports)", () => {
    expect(typeof new Function(`return ${ANNOTATOR_FACTORY};`)()).toBe("function");
    expect(highlightCss()).toContain('mark[data-browser-hl][data-color="pink"]');
    expect(highlightCss()).toContain("prefers-color-scheme:dark");
  });
});

// --- Model -----------------------------------------------------------------------------------------

const quote: TextQuote = { exact: "renard brun", prefix: "Un ", suffix: " saute", start: 3 };
const ID = "hl-00000001";

function sample(): AnnotationsData {
  let data = addHighlight(emptyAnnotations(), { id: ID, url: "https://www.example.com/a#part", title: "Page A", quote, color: "green", now: 10 })!;
  data = addHighlight(data, { id: "hl-00000002", url: "https://news.example.org/b", title: "Page B", quote: { ...quote, exact: "autre chose" }, color: "pink", now: 20 })!;
  return setPageNote(data, "https://www.example.com/a", "Page A", "Ma note\nsur deux lignes", 30);
}

describe("model", () => {
  it("keys pages by http(s) URL without fragment nor credentials", () => {
    expect(annotationUrl("https://user:pw@example.com/a?x=1#top")).toBe("https://example.com/a?x=1");
    expect(annotationUrl("browser://notes")).toBeNull();
    expect(annotationUrl("file:///etc/passwd")).toBeNull();
    expect(annotationUrl(42)).toBeNull();
  });

  it("validates quotes, highlights, patches and stored data", () => {
    expect(sanitizeQuote({ exact: "  a\n\tb  ", prefix: 1, start: -4 })).toEqual({ exact: "a b", prefix: "", suffix: "", start: 0 });
    expect(sanitizeQuote({ exact: "   " })).toBeNull();
    expect(sanitizeQuote({ exact: "x".repeat(5000) })).toBeNull();
    expect(sanitizeHighlightPatch({ color: "red" })).toBeNull();
    expect(sanitizeHighlightPatch({ color: "blue", note: "  " })).toEqual({ color: "blue", note: "" });
    const stored = sanitizeAnnotations({
      highlights: [
        { id: ID, url: "https://a.example/", exact: "ok", createdAt: 1, color: "nope" },
        { id: ID, url: "https://a.example/", exact: "duplicate", createdAt: 1 },
        { id: "bad id!", url: "https://a.example/", exact: "x", createdAt: 1 },
        { id: "hl-00000003", url: "javascript:alert(1)", exact: "x", createdAt: 1 },
      ],
      notes: [{ url: "https://a.example/", text: "note", updatedAt: 2 }, { url: "https://b.example/", text: " ", updatedAt: 2 }],
    });
    expect(stored.highlights).toHaveLength(1);
    expect(stored.highlights[0]).toMatchObject({ exact: "ok", color: "yellow", note: "", updatedAt: 1 });
    expect(stored.notes).toHaveLength(1);
  });

  it("adds, edits and removes highlights and page notes", () => {
    let data = sample();
    expect(data.highlights[0].url).toBe("https://www.example.com/a");
    data = updateHighlight(data, ID, { note: "Important", color: "blue" }, 40);
    expect(data.highlights[0]).toMatchObject({ note: "Important", color: "blue", updatedAt: 40 });
    expect(removeHighlight(data, ID).highlights).toHaveLength(1);
    expect(setPageNote(data, "https://www.example.com/a", "", "", 50).notes).toHaveLength(0);
    expect(removePage(data, "https://www.example.com/a")).toMatchObject({ highlights: [{ id: "hl-00000002" }], notes: [] });
  });

  it("groups by site, searches and filters by color", () => {
    const data = sample();
    expect(annotatedSites(data).map((site) => site.site)).toEqual(["example.com", "news.example.org"]);
    expect(annotatedSites(data, { query: "AUTRE" }).map((site) => site.site)).toEqual(["news.example.org"]);
    expect(annotatedSites(data, { query: "deux lignes" })[0].pages[0].note?.text).toContain("Ma note");
    const green = annotatedSites(data, { colors: ["green"] });
    expect(green).toHaveLength(1);
    expect(green[0].pages[0]).toMatchObject({ note: null, highlights: [{ id: ID }] });
  });
});

describe("export", () => {
  it("writes Markdown grouped by site, escaping page text", () => {
    let data = updateHighlight(sample(), ID, { note: "À **revoir**" }, 40);
    data = addHighlight(data, { id: "hl-00000009", url: "https://www.example.com/a", title: "Page A", quote: { ...quote, exact: "<b>#1</b>" }, color: "yellow", now: 5 })!;
    const markdown = annotationsToMarkdown(data, {}, Date.UTC(2026, 10, 2));
    expect(markdown).toContain("# Notes et surlignages");
    expect(markdown).toContain("Exporté le 2026-11-02.");
    expect(markdown).toContain("## example.com");
    expect(markdown).toContain("### [Page A](<https://www.example.com/a>)");
    expect(markdown).toContain("> renard brun");
    expect(markdown).toContain("- Note : À \\*\\*revoir\\*\\*");
    expect(markdown).toContain("> \\<b\\>\\#1\\</b\\>");
    expect(markdown).toContain("> Ma note\n> sur deux lignes");
  });

  it("writes JSON that reads back as the same data", () => {
    const data = sample();
    expect(sanitizeAnnotations(JSON.parse(annotationsToJson(data)))).toEqual(data);
  });
});

describe("sync records", () => {
  it("round-trips highlights and notes, and rejects misplaced records", () => {
    const data = sample();
    const records = annotationRecords(data);
    expect([...records.keys()]).toEqual([`h:${ID}`, "h:hl-00000002", "n:https://www.example.com/a"]);
    for (const [id, record] of records) expect(sanitizeSyncedAnnotation(JSON.parse(JSON.stringify(record)), id)).toEqual(record);
    expect(sanitizeSyncedAnnotation(records.get(`h:${ID}`), "n:https://www.example.com/a")).toBeNull();
    expect(sanitizeSyncedAnnotation(records.get("n:https://www.example.com/a"), "n:https://other.example/")).toBeNull();
    const merged = mergeAnnotations(emptyAnnotations(), [...records].map(([id, record]) => ({ id, data: record })), []);
    expect(merged).toEqual(sanitizeAnnotations(data));
    expect(mergeAnnotations(data, [], [`h:${ID}`, "n:https://www.example.com/a"])).toMatchObject({ highlights: [{ id: "hl-00000002" }], notes: [] });
  });
});
