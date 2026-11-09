import { sanitizeReaderArticle } from "@shared/reader";
import { readerBlocks } from "./reader";
import { rasterDataUrl, readerImagePlan, sniffRasterType, withReaderImages, type FetchLike } from "./readerImages";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

function article(images: string[]) {
  const content = images.map((src) => ({ tag: "figure", children: [{ tag: "img", src, alt: `alt ${src}`, children: [] }] }));
  return sanitizeReaderArticle({ title: "Titre", content: [{ tag: "p", children: ["Un texte assez long pour être un article. ".repeat(20)] }, ...content] }, "https://news.example/a")!;
}

function fakeFetch(bodies: Record<string, Uint8Array>, log: { url: string; init: unknown }[] = []): FetchLike {
  return async (url, init) => {
    log.push({ url, init });
    const body = bodies[url];
    return { ok: !!body, url, headers: { get: () => null }, arrayBuffer: async () => (body ?? new Uint8Array()).slice().buffer };
  };
}

describe("reader images (ADR-050)", () => {
  it("recognizes raster images by their bytes, never SVG or HTML", () => {
    expect(sniffRasterType(PNG)).toBe("image/png");
    expect(sniffRasterType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffRasterType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(rasterDataUrl(PNG)).toBe(`data:image/png;base64,${Buffer.from(PNG).toString("base64")}`);
    expect(rasterDataUrl(PNG, 4)).toBeNull();
  });

  it("plans https images only, deduplicated and capped", () => {
    const sources = Array.from({ length: 20 }, (_, index) => `https://img.example/${index}.png`);
    expect(readerImagePlan(article(["http://img.example/plain.png", ...sources, sources[0]!]))).toEqual(sources.slice(0, 12));
  });

  it("inlines fetched images without credentials; the others stay their description", async () => {
    const log: { url: string; init: unknown }[] = [];
    const full = await withReaderImages(article(["https://img.example/ok.png", "https://img.example/svg.svg"]), fakeFetch({ "https://img.example/ok.png": PNG, "https://img.example/svg.svg": new TextEncoder().encode("<svg/>") }, log));
    expect(log.map((entry) => entry.init)).toEqual([expect.objectContaining({ credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" }), expect.anything()]);
    const blocks = readerBlocks(full.content);
    expect(blocks).toContainEqual({ kind: "image", src: expect.stringMatching(/^data:image\/png;base64,/), alt: "alt https://img.example/ok.png" });
    expect(blocks).toContainEqual({ kind: "caption", spans: [{ italic: true, text: "alt https://img.example/svg.svg" }] });
  });
});
