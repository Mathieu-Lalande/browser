import { describe, expect, it } from "vitest";
import {
  MAX_FAVORITES,
  addFavorite,
  favoriteLocalId,
  favoriteRecord,
  favoriteTab,
  isFavoriteTab,
  matchesFavorite,
  mergeFavorites,
  moveFavorite,
  removeFavorite,
  sanitizeFavorites,
  sanitizeSyncedFavorite,
  type Favorite,
} from "./favorites";

const fav = (url: string, title = url): Favorite => ({ url, title, favicon: null, createdAt: 1 });

describe("favorites", () => {
  it("adds web pages only, once each, up to the limit", () => {
    let list = addFavorite([], { url: "https://mail.example.com/inbox", title: " Mail " }, 5);
    expect(list).toEqual([{ url: "https://mail.example.com/inbox", title: "Mail", favicon: null, createdAt: 5 }]);
    expect(addFavorite(list, { url: "https://mail.example.com/inbox" }, 6)).toEqual(list);
    expect(addFavorite(list, { url: "file:///etc/passwd" }, 6)).toEqual(list);
    expect(addFavorite(list, { url: "browser://settings" }, 6)).toEqual(list);
    list = addFavorite(list, { url: "https://a.com/" }, 7, 0);
    expect(list.map((f) => f.url)).toEqual(["https://a.com/", "https://mail.example.com/inbox"]);
    const full = Array.from({ length: MAX_FAVORITES }, (_, i) => fav(`https://s${i}.com/`));
    expect(addFavorite(full, { url: "https://more.com/" }, 1)).toHaveLength(MAX_FAVORITES);
  });

  it("removes and reorders", () => {
    const list = [fav("https://a.com/"), fav("https://b.com/"), fav("https://c.com/")];
    expect(removeFavorite(list, "https://b.com/").map((f) => f.url)).toEqual(["https://a.com/", "https://c.com/"]);
    expect(moveFavorite(list, "https://c.com/", 0).map((f) => f.url)).toEqual(["https://c.com/", "https://a.com/", "https://b.com/"]);
  });

  it("sanitizes stored lists", () => {
    expect(sanitizeFavorites([{ url: "https://a.com/", title: 3 }, { url: "https://a.com/" }, { url: "javascript:x" }, null])).toEqual([
      { url: "https://a.com/", title: "a.com", favicon: null, createdAt: 0 },
    ]);
    expect(sanitizeFavorites("nope")).toEqual([]);
  });

  it("matches the favorite's tab: the same page first, else the most recent on its site", () => {
    expect(isFavoriteTab("https://mail.example.com/", "https://mail.example.com/thread/1")).toBe(true);
    expect(isFavoriteTab("https://mail.example.com/", "https://example.com/")).toBe(false);
    expect(isFavoriteTab("https://mail.example.com/", "")).toBe(false);
    const tabs = [
      { url: "https://mail.example.com/a", lastActiveAt: 1 },
      { url: "https://mail.example.com/b", lastActiveAt: 9 },
    ];
    expect(favoriteTab("https://mail.example.com/", tabs)?.url).toBe("https://mail.example.com/b");
    expect(favoriteTab("https://mail.example.com/a", tabs)?.url).toBe("https://mail.example.com/a");
    expect(matchesFavorite([fav("https://mail.example.com/")], "https://mail.example.com/x")).toBe(true);
  });

  it("syncs by URL with positions; validates records; merges", () => {
    const record = favoriteRecord(fav("https://a.com/", "A"), 2);
    expect(sanitizeSyncedFavorite(record, favoriteLocalId("https://a.com/"))).toEqual(record);
    // A record cannot claim another id.
    expect(sanitizeSyncedFavorite(record, favoriteLocalId("https://b.com/"))).toBeNull();
    expect(sanitizeSyncedFavorite({ url: "javascript:x" }, "fav:javascript:x")).toBeNull();
    const local = [{ ...fav("https://a.com/"), favicon: "data:image/png;base64,AA" }, fav("https://b.com/")];
    const merged = mergeFavorites(
      local,
      [
        { url: "https://a.com/", title: "A!", createdAt: 1, position: 1 },
        { url: "https://c.com/", title: "C", createdAt: 2, position: 0 },
      ],
      [favoriteLocalId("https://b.com/")],
    );
    expect(merged.map((f) => [f.url, f.title])).toEqual([
      ["https://c.com/", "C"],
      ["https://a.com/", "A!"],
    ]);
    // The local favicon survives (favicons are never synced).
    expect(merged[1].favicon).toBe("data:image/png;base64,AA");
  });
});
