import { describe, expect, it } from "vitest";
import type { ReaderArticle } from "./reader";
import {
  MAX_READING_TEXT,
  addReadingItem,
  articleParagraphs,
  capReadingList,
  createReadingItem,
  mergeReadingList,
  readingArticle,
  readingEntries,
  readingId,
  readingRecord,
  removeReadingItem,
  sanitizeReadingList,
  sanitizeSyncedReading,
  setReadingRead,
} from "./reading-list";

const article: ReaderArticle = {
  url: "https://news.example/a",
  title: "Un article",
  byline: null,
  siteName: "News",
  lang: "fr",
  dir: null,
  content: [
    { tag: "h2", children: ["Titre"] },
    {
      tag: "div",
      children: [
        { tag: "p", children: ["Premier ", { tag: "a", href: "https://x/", children: ["lien"] }, "."] },
        { tag: "img", src: "data:x", children: [] },
      ],
    },
    { tag: "ul", children: [{ tag: "li", children: ["Un"] }, { tag: "li", children: ["Deux"] }] },
    "texte libre",
  ],
  words: 6,
  minutes: 1,
};

describe("reading list model", () => {
  it("keeps the article as plain paragraphs, no markup", () => {
    expect(articleParagraphs(article.content)).toEqual(["Titre", "Premier lien.", "Un", "Deux", "texte libre"]);
    const item = createReadingItem({ url: article.url, title: "Page" }, article, 10)!;
    expect(item).toMatchObject({ id: readingId(article.url), title: "Un article", siteName: "News", readAt: null, addedAt: 10, minutes: 1 });
    expect(item.text).toBe("Titre\n\nPremier lien.\n\nUn\n\nDeux\n\ntexte libre");
    expect(readingArticle(item).content[1]).toEqual({ tag: "p", children: ["Premier lien."] });
    expect(createReadingItem({ url: "file:///etc/passwd", title: "x" }, null, 1)).toBeNull();
    expect(createReadingItem({ url: "https://x.example/", title: "" }, null, 1)).toMatchObject({ text: "", minutes: null, siteName: "x.example" });
  });

  it("ids are stable per page (fragment ignored) and fragment-safe", () => {
    expect(readingId("https://a.example/x#top")).toBe(readingId("https://a.example/x"));
    expect(readingId("https://a.example/x")).toMatch(/^r[a-z0-9]+$/);
    expect(readingId("https://a.example/y")).not.toBe(readingId("https://a.example/x"));
  });

  it("adds, re-adds on top unread, marks read, removes", () => {
    const a = createReadingItem({ url: "https://a.example/", title: "A" }, article, 1)!;
    const b = createReadingItem({ url: "https://b.example/", title: "B" }, null, 2)!;
    let list = addReadingItem(addReadingItem([], a), b);
    expect(list.map((item) => item.title)).toEqual(["B", "Un article"]);
    list = setReadingRead(list, a.id, true, 50);
    expect(list[1].readAt).toBe(50);
    // Re-added without text: back on top, unread, its offline copy kept.
    list = addReadingItem(list, createReadingItem({ url: "https://a.example/", title: "A" }, null, 60)!);
    expect(list[0]).toMatchObject({ id: a.id, readAt: null, text: a.text });
    expect(readingEntries(list)[0]).toMatchObject({ offline: true });
    expect(readingEntries(list)[0]).not.toHaveProperty("text");
    expect(removeReadingItem(list, a.id).map((item) => item.id)).toEqual([b.id]);
  });

  it("caps the text and the total, read items first", () => {
    const long = createReadingItem({ url: "https://l.example/", title: "L" }, { ...article, content: [{ tag: "p", children: ["x".repeat(MAX_READING_TEXT + 100)] }] }, 1)!;
    expect(long.text.length).toBe(MAX_READING_TEXT);
    const many = Array.from({ length: 120 }, (_, i) => ({ ...long, id: `r${i}`, url: `https://l.example/${i}`, addedAt: i, readAt: i % 2 ? i : null }));
    const capped = capReadingList(many);
    expect(capped.filter((item) => item.text)).toHaveLength(100);
    expect(capped.filter((item) => item.readAt === null).every((item) => item.text)).toBe(true);
  });

  it("validates stored and synced items; merge keeps the local text", () => {
    const a = createReadingItem({ url: "https://a.example/", title: "A" }, article, 1)!;
    expect(sanitizeReadingList([a, a, { url: "javascript:x" }, { ...a, id: "rforged" }])).toHaveLength(1);
    const record = readingRecord({ ...a, readAt: 9 });
    expect(sanitizeSyncedReading(record, a.id)).toMatchObject({ readAt: 9 });
    expect(sanitizeSyncedReading(record, "rother")).toBeNull();
    const merged = mergeReadingList([a], [{ id: a.id, data: { ...record, text: "" } }], []);
    expect(merged[0]).toMatchObject({ readAt: 9, text: a.text });
    expect(mergeReadingList([a], [], [a.id])).toEqual([]);
  });
});
