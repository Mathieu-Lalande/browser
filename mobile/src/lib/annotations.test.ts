import { addHighlight, emptyAnnotations } from "@shared/annotations/model";
import { annotationsToMarkdown } from "@shared/annotations/export";
import { ANNOTATE_MESSAGE, AnnotateBridge, marksFor } from "./annotations";

const data = addHighlight(emptyAnnotations(), {
  id: "hl-00000001",
  url: "https://example.com/a",
  title: "A",
  quote: { exact: "un passage", prefix: "", suffix: "", start: 0 },
  color: "pink",
  now: 1,
})!;

describe("annotate bridge (ADR-037)", () => {
  const message = (nonce: string, body: object) => JSON.stringify({ type: ANNOTATE_MESSAGE, nonce, ...body });

  it("draws the page's highlights with a fresh nonce per document", () => {
    let n = 0;
    const bridge = new AnnotateBridge(() => `nonce${++n}`);
    const script = bridge.loadEnded("https://example.com/a#top", marksFor(data, "https://example.com/a#top"))!;
    expect(script).toContain('"nonce1"');
    expect(script).toContain('"color":"pink"');
    expect(bridge.loadEnded("about:blank", [])).toBeNull();
  });

  it("accepts only this document's messages, validated", () => {
    const bridge = new AnnotateBridge(() => "abc");
    bridge.loadEnded("https://example.com/a", []);
    const page = "https://example.com/a";
    expect(bridge.parse(message("abc", { kind: "click", id: "hl-00000001" }), page, page)).toEqual({ kind: "click", id: "hl-00000001" });
    expect(bridge.parse(message("abc", { kind: "capture", quote: { exact: "  du  texte ", start: 3 } }), page, page)).toEqual({
      kind: "capture",
      quote: { exact: "du texte", prefix: "", suffix: "", start: 3 },
    });
    expect(bridge.parse(message("forged", { kind: "click", id: "x" }), page, page)).toBeUndefined();
    expect(bridge.parse(message("abc", { kind: "click", id: "x" }), "https://evil.example/", page)).toBeUndefined();
    bridge.loadStarted();
    expect(bridge.parse(message("abc", { kind: "click", id: "x" }), page, page)).toBeUndefined();
  });

  it("exports the same Markdown as the desktop", () => {
    expect(annotationsToMarkdown(data, {}, 0)).toContain("> un passage");
  });
});
