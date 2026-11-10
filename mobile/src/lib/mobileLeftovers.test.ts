import { FIND_MESSAGE, FindBridge, cleanFindQuery, findNonce, findScript, MAX_FIND_MATCHES } from "./findInPage";
import { addDownload, canOpenDownload, dispositionFileName, downloadFileName, parseDownloadRequest, parseDownloads, sanitizeFileName, uniqueFileName, type MobileDownload } from "./downloads";
import { LruMap, canCaptureTab, indexThumbnailFiles, parseThumbnailFileName, thumbnailFileName } from "./thumbnails";
import { PrivateSessionTracker, privateIsolation } from "./privateSession";
import { parseQuickAction, quickActionItems, sharedContentTarget } from "./launchActions";

describe("find in page", () => {
  let counter = 0;
  const bridge = () => new FindBridge(() => `n${++counter}`);
  const message = (nonce: string, current: number, total: number) => JSON.stringify({ type: FIND_MESSAGE, nonce, current, total });

  it("uses a fresh nonce per search and only accepts it from the searched origin", () => {
    const find = bridge();
    const script = find.search("https://example.com/a", "chat");
    expect(script).toContain('"chat"');
    const nonce = /\(function\(nonce,op,query\)[\s\S]*\}\)\("([^"]+)"/.exec(script!)![1]!;
    expect(find.parse(message(nonce, 2, 5), "https://example.com/a", "https://example.com/b")).toEqual({ current: 2, total: 5 });
    expect(find.parse(message(nonce, 1, 1), "https://evil.test/", "https://example.com/a")).toBeNull();
    expect(find.parse(message("other", 1, 1), "https://example.com/", "https://example.com/")).toBeNull();
    const again = find.search("https://example.com/a", "chat")!;
    expect(again).not.toContain(nonce);
    expect(find.parse(message(nonce, 1, 1), "https://example.com/", "https://example.com/")).toBeNull();
  });

  it("clamps counts, ignores foreign messages and resets on navigation", () => {
    const find = bridge();
    find.search("https://example.com/", "x");
    const nonce = `n${counter}`;
    expect(find.parse(message(nonce, 9, 3), "https://example.com/", "https://example.com/")).toEqual({ current: 3, total: 3 });
    expect(find.parse(message(nonce, 0, 99999), "https://example.com/", "https://example.com/")).toEqual({ current: 1, total: MAX_FIND_MATCHES });
    expect(find.parse(message(nonce, 0, 0), "https://example.com/", "https://example.com/")).toEqual({ current: 0, total: 0 });
    expect(find.parse('{"type":"media-state"}', "https://example.com/", "https://example.com/")).toBeUndefined();
    expect(find.parse("not json find-result", "https://example.com/", "https://example.com/")).toBeUndefined();
    expect(find.step("next")).toContain('"next"');
    find.loadStarted();
    expect(find.active).toBe(false);
    expect(find.step("next")).toBeNull();
    expect(find.clear()).toBeNull();
  });

  it("clears and never searches non-web pages", () => {
    const find = bridge();
    expect(find.search("about:blank", "x")).toBeNull();
    find.search("https://example.com/", "x");
    expect(find.clear()).toContain('"clear"');
    expect(find.active).toBe(false);
  });

  it("cleans the query and embeds it as JSON", () => {
    expect(cleanFindQuery("  a\u0000b \n c ")).toBe("a b c");
    expect(cleanFindQuery("x".repeat(500))).toHaveLength(200);
    expect(findScript("n", "search", '"</script>')).toContain(JSON.stringify('"</script>'));
    expect(findNonce((n) => new Uint8Array(n).fill(171))).toBe("ab".repeat(16));
  });
});

describe("downloads", () => {
  it("reads Content-Disposition names", () => {
    expect(dispositionFileName('attachment; filename="rapport final.pdf"')).toBe("rapport final.pdf");
    expect(dispositionFileName("attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf; filename=\"x.pdf\"")).toBe("résumé.pdf");
    expect(dispositionFileName("inline")).toBe("");
  });

  it("builds safe names", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName(".hidden")).toBe("hidden");
    expect(sanitizeFileName('a<b>:"c|?*.txt')).toBe("a_b_c_.txt");
    expect(sanitizeFileName(`${"x".repeat(300)}.pdf`)).toMatch(/^x+\.pdf$/);
    expect(sanitizeFileName(`${"x".repeat(300)}.pdf`)).toHaveLength(120);
    expect(downloadFileName("https://a.test/files/doc%20one.pdf?x=1", "", "")).toBe("doc one.pdf");
    expect(downloadFileName("https://a.test/", "", "application/pdf")).toBe("download.pdf");
    expect(downloadFileName("https://a.test/get", 'attachment; filename="data"', "text/csv; charset=utf-8")).toBe("data.csv");
  });

  it("makes names unique", () => {
    expect(uniqueFileName("a.pdf", new Set())).toBe("a.pdf");
    expect(uniqueFileName("a.pdf", new Set(["a.pdf", "a (1).pdf"]))).toBe("a (2).pdf");
    expect(uniqueFileName("README", new Set(["README"]))).toBe("README (1)");
  });

  it("validates requests and stored lists", () => {
    expect(parseDownloadRequest({ downloadUrl: "https://a.test/f.zip" })).toEqual({ url: "https://a.test/f.zip", contentDisposition: "", mimeType: "", contentLength: -1 });
    expect(parseDownloadRequest({ url: "blob:https://a.test/1" })).toBeNull();
    expect(parseDownloadRequest({ url: "file:///etc/hosts" })).toBeNull();
    expect(parseDownloadRequest(null)).toBeNull();
    const item: MobileDownload = { id: "1", name: "a.pdf", size: 10, mimeType: "application/pdf", url: "https://a.test/a.pdf", createdAt: 5 };
    expect(parseDownloads([item, { ...item }, { id: "2", name: "../x", url: "https://a.test" }, "junk"])).toEqual([item]);
    expect(parseDownloads({})).toEqual([]);
  });

  it("caps the list and only opens harmless types", () => {
    const make = (id: string): MobileDownload => ({ id, name: `${id}.pdf`, size: 1, mimeType: "", url: "", createdAt: 0 });
    const { list, dropped } = addDownload([make("b"), make("a")], make("c"), 2);
    expect(list.map((entry) => entry.id)).toEqual(["c", "b"]);
    expect(dropped.map((entry) => entry.id)).toEqual(["a"]);
    expect(canOpenDownload(make("x"))).toBe(true);
    expect(canOpenDownload({ ...make("x"), name: "setup.apk" })).toBe(false);
    expect(canOpenDownload({ ...make("x"), name: "page.html" })).toBe(false);
  });
});

describe("thumbnails", () => {
  it("evicts least recently used entries", () => {
    const lru = new LruMap<string>(2);
    expect(lru.set("a", "1")).toEqual([]);
    lru.set("b", "2");
    lru.get("a");
    expect(lru.set("c", "3")).toEqual([["b", "2"]]);
    expect(lru.keys()).toEqual(["a", "c"]);
    expect(lru.retain(new Set(["c"]))).toEqual([["a", "1"]]);
    expect(lru.delete("c")).toBe("3");
    expect(lru.size).toBe(0);
  });

  it("names and indexes capture files", () => {
    expect(thumbnailFileName("m1-abc", 3)).toBe("m1-abc-3.jpg");
    expect(parseThumbnailFileName("m1-abc-3.jpg")).toEqual({ tabId: "m1-abc", version: 3 });
    expect(parseThumbnailFileName("../x-1.jpg")).toBeNull();
    const { keep, remove } = indexThumbnailFiles([
      { name: "t1-2.jpg", modified: 20 },
      { name: "t1-1.jpg", modified: 10 },
      { name: "t2-5.jpg", modified: 5 },
      { name: "junk.txt", modified: 1 },
    ]);
    expect(keep).toEqual([
      { tabId: "t2", name: "t2-5.jpg", version: 5 },
      { tabId: "t1", name: "t1-2.jpg", version: 2 },
    ]);
    expect(remove.sort()).toEqual(["junk.txt", "t1-1.jpg"]);
  });

  it("never captures private tabs, start pages or loading pages", () => {
    expect(canCaptureTab({ url: "https://a.test/" }, false)).toBe(true);
    expect(canCaptureTab({ url: "https://a.test/" }, true)).toBe(false);
    expect(canCaptureTab({ url: "" }, false)).toBe(false);
    expect(canCaptureTab({ url: "https://a.test/", isLoading: true }, false)).toBe(false);
    expect(canCaptureTab({ url: "http://a.test/", interstitial: {} }, false)).toBe(false);
    expect(canCaptureTab(null, false)).toBe(false);
  });
});

describe("private session", () => {
  it("knows what each platform isolates", () => {
    expect(privateIsolation("ios", false)).toBe("isolated");
    expect(privateIsolation("android", true)).toBe("profile");
    expect(privateIsolation("android", false)).toBe("shared");
  });

  it("reports the visited origins once, when the last private tab closes", () => {
    const tracker = new PrivateSessionTracker();
    expect(tracker.update([])).toBeNull();
    expect(tracker.update(["https://a.test/x", ""])).toBeNull();
    expect(tracker.update(["https://a.test/y", "https://b.test/", "about:blank"])).toBeNull();
    expect(tracker.update([])).toEqual(["https://a.test", "https://b.test"]);
    expect(tracker.update([])).toBeNull();
  });
});

describe("launch actions", () => {
  it("lists and parses quick actions", () => {
    const items = quickActionItems("android");
    expect(items.map((item) => item.id)).toEqual(["new-tab", "private-tab", "search"]);
    expect(items.every((item) => item.icon === null && item.title.length > 0)).toBe(true);
    expect(quickActionItems("ios")[0]!.icon).toBe("add");
    expect(parseQuickAction({ id: "private-tab" })).toBe("private-tab");
    expect(parseQuickAction({ id: "evil" })).toBeNull();
    expect(parseQuickAction(null)).toBeNull();
  });

  it("turns shared content into a page or a search", () => {
    expect(sharedContentTarget({ webUrl: "https://a.test/p" })).toEqual({ kind: "url", url: "https://a.test/p" });
    expect(sharedContentTarget({ text: "Regarde ça : https://a.test/p?q=1, vraiment." })).toEqual({ kind: "url", url: "https://a.test/p?q=1" });
    expect(sharedContentTarget({ webUrl: "javascript:alert(1)", text: "hello\nworld" })).toEqual({ kind: "search", text: "hello world" });
    expect(sharedContentTarget({ text: "file:///etc/hosts" })).toEqual({ kind: "search", text: "file:///etc/hosts" });
    expect(sharedContentTarget({ text: "   " })).toBeNull();
    expect(sharedContentTarget(null)).toBeNull();
  });
});
