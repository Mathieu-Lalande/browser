import { DEFAULT_SETTINGS } from "@shared/settings";
import { contrastRatio, parseCssColor } from "@shared/theme";
import { SEARCH_ENGINES } from "@shared/url";
import { isBookmarked, parseBookmarks, toggleBookmark } from "./bookmarks";
import { appColors, colorsFor, resolveMode, toRnColor } from "./colors";
import { initialCollapse, isSwipeUp, nextCollapse, resolveHorizontalSwipe, rubberBand, shouldDismissCard } from "./gestures";
import { linkMenuScript, parseLinkMenuMessage } from "./linkMenu";
import { sanitizeMobileSettings } from "./mobileSettings";
import { decideNavigation, decideOpenWindow, initialLoad, isHttpsUpgradeFailure, privateModeNotice, schemeOf } from "./navigation";
import { cardRect, gridLayout, scrollOffsetFor, zoomTransform } from "./overviewLayout";
import { buildSheet, MOBILE_COMMANDS } from "./searchSheet";
import { focusOnFirstLayout } from "./focus";
import { faviconUrl, greeting, monogram, siteHue, siteLabel } from "./site";

const none = new Set<string>();

describe("new windows (audit MEDIUM-1)", () => {
  it("opens web pages in a tab, never a top-level data: document", () => {
    expect(decideOpenWindow("https://example.com/", none)).toEqual({ kind: "allow" });
    expect(decideOpenWindow("about:blank", none)).toEqual({ kind: "allow" });
    expect(decideOpenWindow("http://example.com/", none)).toEqual({ kind: "upgrade", url: "https://example.com/", from: "http://example.com/" });
    expect(decideOpenWindow("data:text/html,<h1>phish</h1>", none)).toEqual({ kind: "block" });
    expect(decideOpenWindow("javascript:alert(1)", none)).toEqual({ kind: "block" });
    expect(decideOpenWindow("mailto:a@b.c", none)).toEqual({ kind: "external", url: "mailto:a@b.c" });
  });
});

describe("private mode notice (audit LOW-5)", () => {
  it("says explicitly on Android that cookies are shared", () => {
    expect(privateModeNotice("android")).toContain("Cookies partagés avec les onglets normaux sur Android");
    expect(privateModeNotice("ios")).not.toContain("partagés");
  });
});

describe("navigation policy", () => {
  it("allows web pages, about: and data:", () => {
    expect(decideNavigation({ url: "https://example.com/", isTopFrame: true }, none)).toEqual({ kind: "allow" });
    expect(decideNavigation({ url: "about:blank", isTopFrame: false }, none)).toEqual({ kind: "allow" });
    expect(decideNavigation({ url: "data:text/html,hi", isTopFrame: true }, none)).toEqual({ kind: "allow" });
  });

  it("blocks dangerous and internal schemes", () => {
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "browser://settings", "intent://x#Intent;end", "content://x", "blob:https://a/b"]) {
      expect(decideNavigation({ url, isTopFrame: true }, none)).toEqual({ kind: "block" });
    }
  });

  it("hands mail/phone/sms links to the system, top frame only", () => {
    expect(decideNavigation({ url: "mailto:a@b.c", isTopFrame: true }, none)).toEqual({ kind: "external", url: "mailto:a@b.c" });
    expect(decideNavigation({ url: "TEL:+33123", isTopFrame: true }, none).kind).toBe("external");
    expect(decideNavigation({ url: "tel:+33123", isTopFrame: false }, none)).toEqual({ kind: "block" });
  });

  it("upgrades top-level http to https, except local hosts and exceptions", () => {
    expect(decideNavigation({ url: "http://example.com:8080/a?b", isTopFrame: true }, none)).toEqual({
      kind: "upgrade",
      url: "https://example.com:8080/a?b",
      from: "http://example.com:8080/a?b",
    });
    expect(decideNavigation({ url: "http://example.com/", isTopFrame: false }, none)).toEqual({ kind: "allow" });
    expect(decideNavigation({ url: "http://192.168.1.1/", isTopFrame: true }, none)).toEqual({ kind: "allow" });
    expect(decideNavigation({ url: "http://example.com/", isTopFrame: true }, new Set(["example.com"]))).toEqual({ kind: "allow" });
  });

  it("upgrades explicit loads too", () => {
    expect(initialLoad("http://example.com/", none)).toEqual({ url: "https://example.com/", upgradedFrom: "http://example.com/" });
    expect(initialLoad("https://example.com/", none)).toEqual({ url: "https://example.com/", upgradedFrom: null });
    expect(initialLoad("", none)).toEqual({ url: "", upgradedFrom: null });
  });

  it("recognizes failed upgrades per platform", () => {
    expect(isHttpsUpgradeFailure("ios", -1202)).toBe(true);
    expect(isHttpsUpgradeFailure("ios", -1004)).toBe(true);
    expect(isHttpsUpgradeFailure("ios", -1003)).toBe(false);
    expect(isHttpsUpgradeFailure("ios", -1009)).toBe(false);
    expect(isHttpsUpgradeFailure("android", -11)).toBe(true);
    expect(isHttpsUpgradeFailure("android", -2)).toBe(false);
    expect(isHttpsUpgradeFailure("web", -11)).toBe(false);
  });

  it("extracts schemes", () => {
    expect(schemeOf(" HTTPS://x")).toBe("https:");
    expect(schemeOf("example.com")).toBe("");
  });
});

describe("link menu messages (untrusted page input)", () => {
  it("accepts a well-formed http(s) link", () => {
    expect(parseLinkMenuMessage(JSON.stringify({ type: "link-menu", href: "https://example.com/a b", text: "  Un\nlien\t " }))).toEqual({
      url: "https://example.com/a%20b",
      text: "Un lien",
    });
  });

  it("rejects everything else", () => {
    const bad = [
      undefined,
      42,
      "not json",
      JSON.stringify(null),
      JSON.stringify([]),
      JSON.stringify({ type: "other", href: "https://a.b/" }),
      JSON.stringify({ type: "link-menu", href: "javascript:alert(1)" }),
      JSON.stringify({ type: "link-menu", href: "file:///etc/passwd" }),
      JSON.stringify({ type: "link-menu", href: "data:text/html,x" }),
      JSON.stringify({ type: "link-menu", href: `https://a.b/${"x".repeat(5000)}` }),
      "x".repeat(9000),
    ];
    for (const data of bad) expect(parseLinkMenuMessage(data)).toBeNull();
  });

  it("injects a read-only script that only posts", () => {
    const script = linkMenuScript("ios");
    expect(script).toContain("postMessage");
    expect(script).toContain("-webkit-touch-callout");
    expect(script).not.toContain("onmessage");
    expect(linkMenuScript("android")).not.toContain("-webkit-touch-callout");
    expect(() => new Function(script)).not.toThrow();
  });
});

describe("gesture thresholds", () => {
  it("commits horizontal swipes by distance or fling", () => {
    expect(resolveHorizontalSwipe(-150, 0, 390)).toBe(1);
    expect(resolveHorizontalSwipe(150, 0, 390)).toBe(-1);
    expect(resolveHorizontalSwipe(-60, 0, 390)).toBe(0);
    expect(resolveHorizontalSwipe(-40, -900, 390)).toBe(1);
    expect(resolveHorizontalSwipe(-40, 900, 390)).toBe(0);
    expect(resolveHorizontalSwipe(-10, -2000, 390)).toBe(0);
  });

  it("detects swipe up", () => {
    expect(isSwipeUp(-60, 0)).toBe(true);
    expect(isSwipeUp(-30, -900)).toBe(true);
    expect(isSwipeUp(-30, 0)).toBe(false);
    expect(isSwipeUp(60, -900)).toBe(false);
  });

  it("dismisses cards past 40% or on a fling", () => {
    expect(shouldDismissCard(80, 0, 180)).toBe(true);
    expect(shouldDismissCard(-50, 0, 180)).toBe(false);
    expect(shouldDismissCard(-50, -1000, 180)).toBe(true);
  });

  it("resists past the end", () => {
    expect(Math.abs(rubberBand(300, 200))).toBeLessThan(200);
    expect(rubberBand(-50, 200)).toBeLessThan(0);
    expect(rubberBand(0, 200)).toBe(0);
  });

  it("collapses the toolbar after scrolling down, expands after scrolling up or at the top", () => {
    const scroll = (ys: number[]) => ys.reduce((state, y) => nextCollapse(state, y, 5000, 800), initialCollapse);
    expect(scroll([0, 10, 30, 45]).collapsed).toBe(false);
    expect(scroll([0, 40, 80, 120]).collapsed).toBe(true);
    expect(scroll([0, 40, 80, 400, 390]).collapsed).toBe(true);
    expect(scroll([0, 40, 80, 400, 370]).collapsed).toBe(false);
    expect(scroll([0, 400, 20]).collapsed).toBe(false);
    // Bounce past the bottom changes nothing.
    expect(scroll([0, 100, 4200, 4250, 4190]).collapsed).toBe(true);
  });
});

describe("overview layout", () => {
  it("lays out a two-column grid on phones", () => {
    const layout = gridLayout(390, 8);
    expect(layout.columns).toBe(2);
    expect(layout.padding * 2 + layout.cardWidth * 2 + layout.gap).toBeLessThanOrEqual(390);
    expect(cardRect(layout, 0)).toEqual({ x: 14, y: 8, width: layout.cardWidth, height: layout.cardHeight });
    expect(cardRect(layout, 3).x).toBe(14 + layout.cardWidth + layout.gap);
    expect(cardRect(layout, 3).y).toBe(8 + layout.cardHeight + layout.gap);
    expect(gridLayout(800, 0).columns).toBe(3);
    expect(gridLayout(1000, 0).columns).toBe(4);
  });

  it("scrolls to show a card, within bounds", () => {
    const layout = gridLayout(390, 8);
    expect(scrollOffsetFor(layout, 0, 10, 600, 0)).toBe(0);
    expect(scrollOffsetFor(layout, -1, 10, 600, 0)).toBe(0);
    const last = scrollOffsetFor(layout, 9, 10, 600, 0);
    expect(last).toBeGreaterThan(0);
    expect(last).toBeLessThanOrEqual(layout.top + 5 * layout.cardHeight + 4 * layout.gap - 600);
  });

  it("maps the page onto a card with a center-origin transform", () => {
    const page = { x: 0, y: 50, width: 400, height: 800 };
    const card = { x: 20, y: 100, width: 100, height: 130 };
    const { scale, translateX, translateY } = zoomTransform(page, card);
    expect(scale).toBe(0.25);
    // Top-left corner after scaling around the center, then translating.
    const cx = page.x + page.width / 2;
    const cy = page.y + page.height / 2;
    expect(cx + translateX - (page.width / 2) * scale).toBeCloseTo(card.x);
    expect(cy + translateY - (page.height / 2) * scale).toBeCloseTo(card.y);
  });
});

describe("search sheet", () => {
  const tab = {
    id: "t1",
    url: "https://github.com/",
    title: "GitHub",
    favicon: null,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    isPinned: false,
    isBookmarked: false,
    blockedCount: 0,
    shieldsEnabled: true,
    permissionRequest: null,
    interstitial: null,
    lastActiveAt: 1,
    isAudible: false,
    isMuted: false,
    zoom: 100,
    find: null,
    blockedPopup: null,
  };
  const base = { tabs: [tab], activeTabId: null, history: [], bookmarks: [], engine: SEARCH_ENGINES[0], context: { activeTab: tab }, now: 0 };

  it("only offers commands that make sense on a phone, plus mobile actions", () => {
    const sections = buildSheet({ ...base, query: "" });
    const actions = sections.find((section) => section.id === "commands")!;
    for (const item of actions.items) {
      if (item.kind === "command") expect(MOBILE_COMMANDS.has(item.command.id)).toBe(true);
    }
    expect(actions.items.some((item) => item.kind === "action" && item.action.id === "share")).toBe(true);
    expect(actions.items.some((item) => item.kind === "command" && item.command.id === "devtools")).toBe(false);
  });

  it("finds open tabs and history, and searches with the chosen engine", () => {
    const history = [{ url: "https://gitlab.com/", title: "GitLab", favicon: null, visitCount: 3, lastVisit: 0 }];
    const brave = SEARCH_ENGINES.find((engine) => engine.id === "brave")!;
    const sections = buildSheet({ ...base, query: "git", history, engine: brave });
    expect(sections.find((section) => section.id === "tabs")?.items[0]).toMatchObject({ kind: "tab" });
    expect(sections.find((section) => section.id === "suggestions")?.items[0]).toMatchObject({ kind: "history", url: "https://gitlab.com/" });
    const web = sections.find((section) => section.id === "web")!.items[0];
    expect(web).toMatchObject({ kind: "search", url: "https://search.brave.com/search?q=git" });
  });

  it("puts an address first", () => {
    const sections = buildSheet({ ...base, query: "example.org" });
    expect(sections[0].items[0]).toMatchObject({ kind: "navigate", url: "https://example.org/" });
  });

  it("matches mobile actions", () => {
    const sections = buildSheet({ ...base, query: "privé" });
    const items = sections.flatMap((section) => section.items);
    expect(items.some((item) => item.kind === "action" && item.action.id === "new-private-tab")).toBe(true);
  });
});

describe("site helpers", () => {
  it("labels, monograms and favicons", () => {
    expect(siteLabel("https://www.lemonde.fr/a")).toBe("lemonde.fr");
    expect(siteLabel("data:text/html,x")).toBe("data:");
    expect(siteLabel("")).toBe("");
    expect(monogram("https://www.github.com/")).toBe("G");
    expect(monogram("https://m.wikipedia.org/")).toBe("W");
    expect(faviconUrl("https://a.example:8443/x?y")).toBe("https://a.example:8443/favicon.ico");
    expect(faviconUrl("data:text/html,x")).toBeNull();
    expect(siteHue("https://a.example/")).toBe(siteHue("https://a.example/other"));
    expect(siteHue("https://a.example/")).toBeGreaterThanOrEqual(0);
  });

  it("greets in French", () => {
    expect(greeting(8)).toBe("Bonjour");
    expect(greeting(14)).toBe("Bon après-midi");
    expect(greeting(20)).toBe("Bonsoir");
    expect(greeting(2)).toBe("Bonne nuit");
  });
});

describe("colors", () => {
  it("converts translucent CSS colors to rgba()", () => {
    expect(toRnColor("#123456")).toBe("#123456");
    expect(toRnColor("rgb(10 20 30 / 0.5)")).toBe("rgba(10, 20, 30, 0.5)");
  });

  it("keeps the shared contrast guarantees", () => {
    for (const mode of ["light", "dark"] as const) {
      const colors = appColors("#ff6b6b", "#ffa94d", mode);
      const ratio = contrastRatio(parseCssColor(colors.text)!.color, parseCssColor(colors.bg)!.color);
      expect(ratio).toBeGreaterThanOrEqual(7);
      expect(colors.surface.startsWith("rgba(")).toBe(true);
    }
  });

  it("resolves the mode and the private palette", () => {
    expect(resolveMode("system", "dark")).toBe("dark");
    expect(resolveMode("system", null)).toBe("light");
    expect(resolveMode("light", "dark")).toBe("light");
    expect(colorsFor(DEFAULT_SETTINGS, "light", null, true).scheme).toBe("dark");
    expect(colorsFor(DEFAULT_SETTINGS, "light", "#4fc3a1", false).accent).toBe("#4fc3a1");
  });
});

describe("bookmarks", () => {
  it("toggles and validates", () => {
    let list = toggleBookmark([], { url: "https://a.example/", title: "A" }, "b1", 1);
    expect(isBookmarked(list, "https://a.example/")).toBe(true);
    list = toggleBookmark(list, { url: "https://a.example/", title: "A" }, "b2", 2);
    expect(list).toEqual([]);
    expect(toggleBookmark([], { url: "", title: "" }, "b3", 3)).toEqual([]);
    expect(parseBookmarks([{ id: "x", url: "javascript:1" }, { id: "y", url: "https://y.example/", title: 5 }, "nope"])).toEqual([
      { id: "y", url: "https://y.example/", title: "", favicon: null, createdAt: 0 },
    ]);
    expect(parseBookmarks("nope")).toEqual([]);
  });
});

describe("mobile settings", () => {
  it("sanitizes", () => {
    expect(sanitizeMobileSettings({ haptics: false, collapseToolbar: "yes", extra: 1 })).toEqual({ haptics: false, collapseToolbar: true });
    expect(sanitizeMobileSettings(null)).toEqual({ haptics: true, collapseToolbar: true });
  });
});

describe("search sheet context", () => {
  const page = { url: "https://example.org/", title: "Example", favicon: null, visitCount: 5, lastVisit: 0 };
  const input = {
    query: "",
    tabs: [],
    activeTabId: null,
    history: [page],
    bookmarks: [],
    engine: SEARCH_ENGINES[0],
    context: {},
    now: 0,
  };
  const ids = (sections: ReturnType<typeof buildSheet>) =>
    sections.flatMap((section) => section.items).map((item) => (item.kind === "command" ? item.command.id : item.kind === "action" ? item.action.id : item.key));

  it("leads with frequent sites and hides destructive actions before typing", () => {
    const sections = buildSheet({ ...input, spaceCount: 2 });
    expect(sections[0]).toMatchObject({ title: "Sites fréquents", items: [{ kind: "history", url: page.url }] });
    expect(ids(sections)).not.toContain("clear-history");
    expect(ids(buildSheet({ ...input, query: "effacer", spaceCount: 2 }))).toContain("clear-history");
  });

  it("hides space navigation with a single space, and profile actions in private browsing", () => {
    expect(ids(buildSheet({ ...input, spaceCount: 1 }))).not.toContain("next-space");
    expect(ids(buildSheet({ ...input, spaceCount: 2 }))).toContain("next-space");
    const privateIds = ids(buildSheet({ ...input, spaceCount: 2, isPrivate: true }));
    for (const id of ["new-space", "next-space", "sync-now", "new-private-tab"]) expect(privateIds).not.toContain(id);
    expect(buildSheet({ ...input, isPrivate: true }).some((section) => section.title === "Sites fréquents")).toBe(false);
  });
});

describe("search field focus", () => {
  it("focuses once, on the frame after the first layout", () => {
    const focus = jest.fn();
    const frames: (() => void)[] = [];
    const onLayout = focusOnFirstLayout(focus, (run) => frames.push(run));
    onLayout();
    onLayout();
    expect(focus).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    frames[0]();
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
