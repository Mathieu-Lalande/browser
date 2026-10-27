import { describe, expect, it } from "vitest";
import { DEFAULT_SPACE } from "@shared/spaces";
import { parseSession, type SessionTabList } from "./session";

const tab = (url: string, pinned = false) => ({ url, title: url, favicon: null, pinned });
const space = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, icon: "star", color: null, isolated: false, ...extra });

/** Parses a v1 session and returns the migrated tab list of each window. */
const v1Lists = (data: unknown): SessionTabList[] | undefined =>
  parseSession(data, 1)?.windows.map((window) => {
    const { spaceId: _, ...list } = window.spaces[0];
    return list;
  });

describe("parseSession v1 (migrated to spaces)", () => {
  it("rejects a malformed root", () => {
    expect(parseSession(null, 1)).toBeNull();
    expect(parseSession({}, 1)).toBeNull();
    expect(parseSession({ windows: {} }, 1)).toBeNull();
  });

  it("moves every window's tabs into the default space", () => {
    const window = { tabs: [tab("https://a.com/", true), tab(""), tab("https://b.com/")], activeIndex: 2 };
    expect(parseSession({ windows: [window, window] }, 1)).toEqual({
      spaces: [DEFAULT_SPACE],
      windows: [
        { activeSpaceId: DEFAULT_SPACE.id, spaces: [{ spaceId: DEFAULT_SPACE.id, ...window }] },
        { activeSpaceId: DEFAULT_SPACE.id, spaces: [{ spaceId: DEFAULT_SPACE.id, ...window }] },
      ],
    });
    expect(DEFAULT_SPACE.name).toBe("Personnel");
  });

  it("migrates an empty session to the default space alone", () => {
    expect(parseSession({ windows: [] }, 1)).toEqual({ spaces: [DEFAULT_SPACE], windows: [] });
  });

  it("drops tabs that could not be loaded and windows left empty", () => {
    expect(
      v1Lists({
        windows: [
          { tabs: [tab("file:///etc/passwd"), tab("https://a.com/"), { url: 3 }], activeIndex: 1 },
          { tabs: [tab("javascript:alert(1)")], activeIndex: 0 },
          { tabs: "nope" },
        ],
      }),
    ).toEqual([{ tabs: [tab("https://a.com/")], activeIndex: 0 }]);
  });

  it("keeps the active tab when tabs before it are dropped or reordered", () => {
    const [list] = v1Lists({
      windows: [{ tabs: [tab("file:///x"), tab("https://a.com/"), tab("https://b.com/"), tab("https://pin.com/", true)], activeIndex: 2 }],
    })!;
    // Pinned tabs lead, the rest keep their order.
    expect(list.tabs.map((t) => t.url)).toEqual(["https://pin.com/", "https://a.com/", "https://b.com/"]);
    expect(list.activeIndex).toBe(2);
  });

  it("falls back to the first tab for an invalid active index, and sanitizes fields", () => {
    expect(v1Lists({ windows: [{ tabs: [{ url: "https://a.com/", favicon: "javascript:x", pinned: "yes" }], activeIndex: 9 }] })).toEqual([
      { tabs: [{ url: "https://a.com/", title: "", favicon: null, pinned: false }], activeIndex: 0 },
    ]);
  });
});

describe("parseSession v2", () => {
  it("rejects a malformed root", () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession({ windows: [] })).toBeNull();
    expect(parseSession({ spaces: {}, windows: [] })).toBeNull();
  });

  it("keeps valid spaces, windows and splits", () => {
    const session = {
      spaces: [space("work", { color: "#4fc3a1", isolated: true }), space("home")],
      windows: [
        {
          activeSpaceId: "home",
          spaces: [
            { spaceId: "work", tabs: [tab("https://a.com/"), tab("https://b.com/")], activeIndex: 1, split: { tabIndexes: [1, 0], ratioX: 0.3, ratioY: 0.5 } },
            { spaceId: "home", tabs: [tab("")], activeIndex: 0 },
          ],
        },
      ],
    };
    expect(parseSession(session)).toEqual(session);
  });

  it("always has a space, and drops invalid or duplicate ones", () => {
    expect(parseSession({ spaces: [], windows: [] })).toEqual({ spaces: [DEFAULT_SPACE], windows: [] });
    const parsed = parseSession({ spaces: [space("a"), space("a"), space("bad id!"), { id: "b", name: 3, color: "red" }], windows: [] });
    expect(parsed?.spaces).toEqual([space("a"), { id: "b", name: "Espace", icon: "star", color: null, isolated: false }]);
  });

  it("migrates the emoji icons of earlier versions to Lucide icon names", () => {
    const parsed = parseSession({
      spaces: [
        { id: "personal", name: "Personnel", icon: "🏠", color: null, isolated: false },
        { id: "work", name: "Travail", icon: "💼", color: "#4fc3a1", isolated: true },
        { id: "trips", name: "Voyages", icon: "✈️", color: null, isolated: false },
        { id: "odd", name: "Autre", icon: "🦄", color: null, isolated: false },
      ],
      windows: [{ activeSpaceId: "work", spaces: [{ spaceId: "work", tabs: [tab("https://a.com/")], activeIndex: 0 }] }],
    });
    expect(parsed?.spaces.map((space) => [space.id, space.icon])).toEqual([
      ["personal", "circle-user"],
      ["work", "briefcase"],
      ["trips", "plane"],
      ["odd", "star"],
    ]);
    expect(parsed?.spaces[1]).toEqual({ id: "work", name: "Travail", icon: "briefcase", color: "#4fc3a1", isolated: true });
    expect(parsed?.windows[0].activeSpaceId).toBe("work");
  });

  it("drops tab lists of unknown spaces, and falls back to a known active space", () => {
    const parsed = parseSession({
      spaces: [space("a")],
      windows: [
        { activeSpaceId: "gone", spaces: [{ spaceId: "gone", tabs: [tab("https://x.com/")], activeIndex: 0 }, { spaceId: "a", tabs: [tab("")], activeIndex: 0 }] },
        { activeSpaceId: "a", spaces: [{ spaceId: "gone", tabs: [tab("https://x.com/")], activeIndex: 0 }] },
      ],
    });
    expect(parsed?.windows).toEqual([{ activeSpaceId: "a", spaces: [{ spaceId: "a", tabs: [tab("")], activeIndex: 0 }] }]);
  });

  it("remaps split indexes through dropped and reordered tabs, and drops splits left with one tab", () => {
    const parsed = parseSession({
      spaces: [space("a")],
      windows: [
        {
          activeSpaceId: "a",
          spaces: [
            {
              spaceId: "a",
              tabs: [tab("file:///x"), tab("https://a.com/"), tab("https://b.com/"), tab("https://pin.com/", true)],
              activeIndex: 1,
              split: { tabIndexes: [2, 3, 3, 0], ratioX: 5, ratioY: "x" },
            },
          ],
        },
        { activeSpaceId: "a", spaces: [{ spaceId: "a", tabs: [tab("https://a.com/"), tab("file:///x")], activeIndex: 0, split: { tabIndexes: [0, 1] } }] },
      ],
    });
    const [first, second] = parsed!.windows;
    expect(first.spaces[0].split).toEqual({ tabIndexes: [2, 0], ratioX: 0.8, ratioY: 0.5 });
    expect(first.spaces[0].activeIndex).toBe(1);
    expect(second.spaces[0].split).toBeUndefined();
  });

  it("restores internal pages, but not unknown internal URLs", () => {
    const lists = v1Lists({
      windows: [{ tabs: [tab("browser://settings"), tab("browser://evil"), tab("browser:settings")], activeIndex: 0 }],
    });
    expect(lists?.[0].tabs.map((t) => t.url)).toEqual(["browser://settings"]);
  });

  it("keeps small data: favicons only (audit HIGH-1)", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const lists = v1Lists({
      windows: [
        {
          tabs: [
            { url: "https://a.com/", title: "A", favicon: "https://a.com/favicon.ico", pinned: false },
            { url: "https://b.com/", title: "B", favicon: png, pinned: false },
            { url: "https://c.com/", title: "C", favicon: `data:image/png;base64,${"A".repeat(20_000)}`, pinned: false },
          ],
          activeIndex: 0,
        },
      ],
    });
    expect(lists?.[0].tabs.map((t) => t.favicon)).toEqual([null, png, null]);
  });
});
