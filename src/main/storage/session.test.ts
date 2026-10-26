import { describe, expect, it } from "vitest";
import { parseSession } from "./session";

const tab = (url: string, pinned = false) => ({ url, title: url, favicon: null, pinned });

describe("parseSession", () => {
  it("rejects a malformed root", () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession({})).toBeNull();
    expect(parseSession({ windows: {} })).toBeNull();
  });

  it("keeps valid windows and tabs", () => {
    const session = { windows: [{ tabs: [tab("https://a.com/", true), tab(""), tab("https://b.com/")], activeIndex: 2 }] };
    expect(parseSession(session)).toEqual(session);
  });

  it("drops tabs that could not be loaded and windows left empty", () => {
    expect(
      parseSession({
        windows: [
          { tabs: [tab("file:///etc/passwd"), tab("https://a.com/"), { url: 3 }], activeIndex: 1 },
          { tabs: [tab("javascript:alert(1)")], activeIndex: 0 },
          { tabs: "nope" },
        ],
      }),
    ).toEqual({ windows: [{ tabs: [tab("https://a.com/")], activeIndex: 0 }] });
  });

  it("keeps the active tab when tabs before it are dropped or reordered", () => {
    const parsed = parseSession({
      windows: [{ tabs: [tab("file:///x"), tab("https://a.com/"), tab("https://b.com/"), tab("https://pin.com/", true)], activeIndex: 2 }],
    });
    // Pinned tabs lead, the rest keep their order.
    expect(parsed?.windows[0].tabs.map((t) => t.url)).toEqual(["https://pin.com/", "https://a.com/", "https://b.com/"]);
    expect(parsed?.windows[0].activeIndex).toBe(2);
  });

  it("falls back to the first tab for an invalid active index, and sanitizes fields", () => {
    const parsed = parseSession({
      windows: [{ tabs: [{ url: "https://a.com/", favicon: "javascript:x", pinned: "yes" }], activeIndex: 9 }],
    });
    expect(parsed).toEqual({ windows: [{ tabs: [{ url: "https://a.com/", title: "", favicon: null, pinned: false }], activeIndex: 0 }] });
  });

  it("restores internal pages, but not unknown internal URLs", () => {
    const parsed = parseSession({
      windows: [{ tabs: [tab("browser://settings"), tab("browser://evil"), tab("browser:settings")], activeIndex: 0 }],
    });
    expect(parsed?.windows[0].tabs.map((t) => t.url)).toEqual(["browser://settings"]);
  });
});
