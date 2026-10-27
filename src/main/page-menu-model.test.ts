import { describe, expect, it } from "vitest";
import { DEFAULT_SEARCH_ENGINE } from "@shared/url";
import { buildPageMenu, isSavableUrl, selectionAddress, type PageMenuContext, type PageMenuEntry, type PageMenuParams } from "./page-menu-model";

const params = (overrides: Partial<PageMenuParams> = {}): PageMenuParams => ({
  linkURL: "",
  linkText: "",
  srcURL: "",
  mediaType: "none",
  hasImageContents: false,
  isEditable: false,
  selectionText: "",
  misspelledWord: "",
  dictionarySuggestions: [],
  editFlags: { canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: false, canSelectAll: true },
  mediaFlags: { isPaused: true, isMuted: false, isLooping: false, hasAudio: true, canShowPictureInPicture: true },
  ...overrides,
});

const context = (overrides: Partial<PageMenuContext> = {}): PageMenuContext => ({
  canGoBack: true,
  canGoForward: false,
  isPrivate: false,
  spaces: [{ id: "s2", name: "Travail" }],
  canSplit: true,
  engine: DEFAULT_SEARCH_ENGINE,
  ...overrides,
});

type Item = Exclude<PageMenuEntry, { separator: true }>;
const items = (entries: PageMenuEntry[]): Item[] => entries.filter((entry): entry is Item => !("separator" in entry));
const ids = (entries: PageMenuEntry[]) => items(entries).map((entry) => entry.id);
const item = (entries: PageMenuEntry[], id: string) => items(entries).find((entry) => entry.id === id);

describe("page context menu", () => {
  it("offers navigation and page tools on a plain right click", () => {
    const menu = buildPageMenu(params(), context());
    expect(ids(menu)).toEqual(["page-back", "page-forward", "page-reload", "page-save", "page-copy-url", "page-site-info", "inspect"]);
    expect(item(menu, "page-back")?.enabled).toBe(true);
    expect(item(menu, "page-forward")?.enabled).toBe(false);
  });

  it("opens web links in every way, spaces included", () => {
    const menu = buildPageMenu(params({ linkURL: "https://example.com/a", linkText: "A" }), context());
    expect(ids(menu)).toEqual(
      expect.arrayContaining(["link-open-tab", "link-open-background", "link-open-split", "link-open-space", "link-open-private", "link-copy", "link-copy-text"]),
    );
    expect(item(menu, "link-open-space")?.submenu?.map((entry) => ("id" in entry ? entry.id : ""))).toEqual(["link-open-space:s2"]);
    expect(ids(menu)).not.toContain("page-back");
  });

  it("never opens file:, javascript: or internal links", () => {
    for (const linkURL of ["file:///etc/passwd", "javascript:alert(1)", "browser://settings", "data:text/html,x"]) {
      const menu = ids(buildPageMenu(params({ linkURL, linkText: "x" }), context()));
      expect(menu.filter((id) => id.startsWith("link-open"))).toEqual([]);
    }
    expect(ids(buildPageMenu(params({ linkURL: "javascript:alert(1)" }), context()))).not.toContain("link-copy");
  });

  it("keeps private windows to themselves", () => {
    const menu = buildPageMenu(params({ linkURL: "https://example.com/" }), context({ isPrivate: true, spaces: [] }));
    expect(ids(menu)).not.toContain("link-open-space");
    expect(item(menu, "link-open-private")?.label).toBe("Ouvrir dans une nouvelle fenêtre privée");
    const spell = buildPageMenu(params({ isEditable: true, misspelledWord: "bonjuor", dictionarySuggestions: ["bonjour"] }), context({ isPrivate: true }));
    expect(ids(spell)).not.toContain("spell-add");
  });

  it("has image, media, selection and editing entries", () => {
    const image = buildPageMenu(params({ mediaType: "image", srcURL: "https://example.com/a.png", hasImageContents: true }), context());
    expect(ids(image)).toEqual(expect.arrayContaining(["image-open", "image-copy", "image-copy-url", "image-save"]));
    const inline = buildPageMenu(params({ mediaType: "image", srcURL: "data:image/png;base64,AA", hasImageContents: true }), context());
    expect(item(inline, "image-open")?.enabled).toBe(false);
    expect(item(inline, "image-save")?.enabled).toBe(true);

    const video = buildPageMenu(params({ mediaType: "video" }), context());
    expect(item(video, "media-play")?.label).toBe("Lecture");
    expect(ids(video)).toEqual(expect.arrayContaining(["media-mute", "media-loop", "media-pip"]));

    const selection = buildPageMenu(params({ selectionText: "un renard brun" }), context());
    expect(item(selection, "selection-search")?.label).toBe("Rechercher « un renard brun » avec DuckDuckGo");
    expect(ids(selection)).not.toContain("selection-open");
    expect(ids(buildPageMenu(params({ selectionText: "example.com/page" }), context()))).toContain("selection-open");

    const editable = buildPageMenu(params({ isEditable: true, misspelledWord: "bonjuor", dictionarySuggestions: ["bonjour", "bonjours"] }), context());
    expect(ids(editable).slice(0, 3)).toEqual(["spell-0", "spell-1", "spell-add"]);
    expect(ids(editable)).toEqual(expect.arrayContaining(["edit-undo", "edit-paste-plain", "edit-select-all"]));
  });

  it("reads a selection as an address only when it is one", () => {
    expect(selectionAddress("example.com", DEFAULT_SEARCH_ENGINE)).toBe("https://example.com/");
    expect(selectionAddress("hello world", DEFAULT_SEARCH_ENGINE)).toBeNull();
    expect(selectionAddress("javascript:alert(1)", DEFAULT_SEARCH_ENGINE)).toBeNull();
    expect(selectionAddress("file:///etc/passwd", DEFAULT_SEARCH_ENGINE)).toBeNull();
    expect(isSavableUrl("https://a.b/x.png")).toBe(true);
    expect(isSavableUrl("file:///x.png")).toBe(false);
  });
});
