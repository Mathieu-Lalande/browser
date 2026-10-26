import { describe, expect, it } from "vitest";
import { Bookmarks } from "./bookmarks";

const NOW = Date.UTC(2026, 5, 1);

describe("Bookmarks", () => {
  it("adds, finds and removes bookmarks", () => {
    const bookmarks = new Bookmarks();
    const added = bookmarks.add({ url: "https://a.com/", title: " A ", favicon: "https://a.com/f.ico" }, NOW);
    expect(added).toMatchObject({ url: "https://a.com/", title: "A", favicon: "https://a.com/f.ico", createdAt: NOW });
    expect(bookmarks.has("https://a.com/")).toBe(true);
    // Adding the same URL again returns the existing bookmark.
    expect(bookmarks.add({ url: "https://a.com/" }, NOW + 1)?.id).toBe(added?.id);
    expect(bookmarks.list()).toHaveLength(1);
    expect(bookmarks.remove(added!.id)).toBe(true);
    expect(bookmarks.remove(added!.id)).toBe(false);
    expect(bookmarks.has("https://a.com/")).toBe(false);
  });

  it("falls back to the URL as title and refuses non-web URLs", () => {
    const bookmarks = new Bookmarks();
    expect(bookmarks.add({ url: "https://www.a.com/docs" }, NOW)?.title).toBe("a.com/docs");
    expect(bookmarks.add({ url: "file:///etc/passwd" }, NOW)).toBeNull();
    expect(bookmarks.add({ url: "javascript:alert(1)" }, NOW)).toBeNull();
    expect(bookmarks.add({ url: "browser://settings" }, NOW)).toBeNull();
  });

  it("toggles a page", () => {
    const bookmarks = new Bookmarks();
    expect(bookmarks.toggle({ url: "https://a.com/", title: "A" }, NOW)).toBe(true);
    expect(bookmarks.has("https://a.com/")).toBe(true);
    expect(bookmarks.toggle({ url: "https://a.com/" }, NOW)).toBe(false);
    expect(bookmarks.list()).toEqual([]);
  });

  it("ignores unknown folders", () => {
    const bookmarks = new Bookmarks({ bookmarks: [], folders: [{ id: "f1", name: "Travail", createdAt: NOW }] });
    expect(bookmarks.add({ url: "https://a.com/", folderId: "f1" }, NOW)?.folderId).toBe("f1");
    expect(bookmarks.add({ url: "https://b.com/", folderId: "nope" }, NOW)).not.toHaveProperty("folderId");
  });

  it("parses stored data, dropping invalid bookmarks and dangling folders", () => {
    expect(Bookmarks.parse(null)).toBeNull();
    expect(Bookmarks.parse({ bookmarks: "x" })).toBeNull();
    const data = Bookmarks.parse({
      bookmarks: [
        { id: "1", url: "https://a.com/", title: "A", favicon: null, createdAt: NOW, folderId: "f1" },
        { id: "2", url: "https://b.com/", folderId: "gone" },
        { id: "3", url: "file:///etc/passwd" },
        { url: "https://no-id.com/" },
      ],
      folders: [{ id: "f1", name: "Travail", createdAt: NOW }, { id: 3 }],
    });
    expect(data).toEqual({
      bookmarks: [
        { id: "1", url: "https://a.com/", title: "A", favicon: null, createdAt: NOW, folderId: "f1" },
        { id: "2", url: "https://b.com/", title: "b.com", favicon: null, createdAt: 0 },
      ],
      folders: [{ id: "f1", name: "Travail", createdAt: NOW }],
    });
    expect(new Bookmarks(data!).has("https://b.com/")).toBe(true);
  });
});
