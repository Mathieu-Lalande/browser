import { MEDIA_MESSAGE, MediaWatchGuard, mediaControlScript, mediaWatchScript, miniBarOf } from "./media";

const message = (nonce: string, probe: unknown = { title: "Chanson", artist: "Ada", element: { duration: 30, position: 2, paused: false } }) =>
  JSON.stringify({ type: MEDIA_MESSAGE, nonce, probe });

describe("MediaWatchGuard", () => {
  it("accepts this document's messages only, on its origin", () => {
    let n = 0;
    const guard = new MediaWatchGuard(() => `nonce${++n}`);
    expect(guard.parse(message("nonce1"), "https://a.test/", "https://a.test/")).toBeUndefined();
    const script = guard.loadEnded("https://a.test/page");
    expect(script).toContain('"nonce1"');
    expect(guard.parse(message("nonce1"), "https://a.test/x", "https://a.test/page")?.title).toBe("Chanson");
    expect(guard.parse(message("other"), "https://a.test/x", "https://a.test/page")).toBeUndefined();
    expect(guard.parse(message("nonce1"), "https://evil.test/", "https://a.test/page")).toBeUndefined();
    expect(guard.parse("not json", "https://a.test/", "https://a.test/")).toBeUndefined();
    guard.loadStarted();
    expect(guard.parse(message("nonce1"), "https://a.test/", "https://a.test/")).toBeUndefined();
    expect(guard.loadEnded("about:blank")).toBeNull();
  });
});

describe("scripts", () => {
  it("embed their parameters as JSON", () => {
    expect(mediaWatchScript('a"b')).toContain('"a\\"b"');
    expect(mediaControlScript("pause")).toContain('"pause"');
  });
});

describe("miniBarOf", () => {
  const tab = { title: "Onglet", url: "https://www.radio.test/" };
  it("shows the page's media until closed", () => {
    const guard = new MediaWatchGuard(() => "n");
    guard.loadEnded("https://a.test/");
    const probe = guard.parse(message("n"), "https://a.test/", "https://a.test/")!;
    expect(miniBarOf(probe, tab, false)).toEqual({ title: "Chanson", subtitle: "Ada", playing: true });
    expect(miniBarOf(probe, tab, true)).toBeNull();
    expect(miniBarOf({ ...probe, element: null }, tab, false)).toBeNull();
    expect(miniBarOf({ ...probe, title: "", artist: "" }, tab, false)).toMatchObject({ title: "Onglet", subtitle: "radio.test" });
  });
});
