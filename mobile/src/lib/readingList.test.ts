import type { ReaderArticle } from "@shared/reader";
import { mergeReadingList, readingArticle, readingRecord, setReadingRead } from "@shared/reading-list";
import { isInReadingList, readingSections, toggleReadLater, withArticle } from "./readingList";

const article: ReaderArticle = {
  url: "https://news.example/a",
  title: "Un article",
  byline: null,
  siteName: "News",
  lang: "fr",
  dir: null,
  content: [{ tag: "p", children: ["Premier paragraphe."] }, { tag: "p", children: ["Second."] }],
  words: 3,
  minutes: 1,
};

describe("reading list (phone)", () => {
  it("adds a page, then its offline text; toggling again removes it", () => {
    const added = toggleReadLater([], { url: article.url, title: "Page" }, 10);
    expect(added.added).toBe(true);
    expect(isInReadingList(added.list, `${article.url}#comments`)).toBe(true);
    expect(added.list[0]).toMatchObject({ text: "", readAt: null });

    const complete = withArticle(added.list, article, 20);
    expect(complete[0]).toMatchObject({ title: "Un article", siteName: "News", text: "Premier paragraphe.\n\nSecond.", addedAt: 10 });
    expect(readingArticle(complete[0]).content).toHaveLength(2);

    expect(toggleReadLater(complete, { url: article.url, title: "Page" }, 30)).toEqual({ list: [], added: false });
    expect(toggleReadLater([], { url: "about:blank", title: "" }, 1).added).toBe(false);
  });

  it("merges the desktop's records and splits read from unread", () => {
    const local = withArticle(toggleReadLater([], { url: article.url, title: "Page" }, 10).list, article, 10);
    const desktop = toggleReadLater([], { url: "https://desk.example/", title: "Du bureau" }, 50).list;
    const merged = mergeReadingList(
      local,
      desktop.map((item) => ({ id: item.id, data: readingRecord(item) })),
      [],
    );
    expect(merged.map((item) => item.title)).toEqual(["Du bureau", "Un article"]);
    const sections = readingSections(setReadingRead(merged, local[0].id, true, 60));
    expect(sections.unread.map((item) => item.title)).toEqual(["Du bureau"]);
    expect(sections.read.map((item) => item.title)).toEqual(["Un article"]);
  });
});
