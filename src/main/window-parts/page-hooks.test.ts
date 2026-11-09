import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { PageHooks, type PageFeatures } from "./page-hooks";

function setup(isPrivate: boolean) {
  const features = {
    isPrivate,
    peek: { open: vi.fn() },
    gestures: { feedPage: vi.fn(), zoom: vi.fn() },
    media: { report: vi.fn() },
    translator: { pageReady: vi.fn(async () => {}), stateOf: vi.fn(() => null) },
    annotator: { pageReady: vi.fn(), clicked: vi.fn() },
    storePages: { pageReady: vi.fn(), clicked: vi.fn() },
  } satisfies PageFeatures;
  const deps = {
    base: { isBookmarked: (url: string) => url === "https://saved.example/" },
    features,
    boosts: { boostPage: vi.fn() },
    contextMenu: vi.fn(),
    watchPasswordForms: vi.fn(),
    watchAutofill: vi.fn(),
    watchNotifications: vi.fn(),
    watchPageWheel: vi.fn(),
  };
  return { hooks: new PageHooks(deps).hooks(), deps, features };
}

const page = {} as WebContents;

describe("PageHooks", () => {
  it("keeps the shared profile hooks", () => {
    const { hooks } = setup(false);
    expect(hooks.isBookmarked?.("https://saved.example/")).toBe(true);
  });

  it("boosts each new document with the window's privacy", () => {
    const normal = setup(false);
    normal.hooks.boostPage?.(page);
    expect(normal.deps.boosts.boostPage).toHaveBeenCalledWith(page, false);
    const priv = setup(true);
    priv.hooks.boostPage?.(page);
    expect(priv.deps.boosts.boostPage).toHaveBeenCalledWith(page, true);
  });

  it("routes each page event to the feature that owns it", () => {
    const { hooks, deps, features } = setup(false);
    hooks.pageReady?.("t1", page);
    hooks.notifyPage?.("t1", page);
    hooks.gesturePage?.(page);
    hooks.peekLink?.("t1", "https://example.com/");
    hooks.pageZoom?.("t1", -1);
    hooks.media?.("t1", page, true);
    hooks.translatePage?.("t1", page);
    hooks.annotatePage?.("t1", page);
    expect(deps.watchPasswordForms).toHaveBeenCalledWith("t1", page);
    expect(deps.watchAutofill).toHaveBeenCalledWith("t1", page);
    expect(deps.watchNotifications).toHaveBeenCalledWith("t1", page);
    expect(deps.watchPageWheel).toHaveBeenCalledWith(page);
    expect(features.peek.open).toHaveBeenCalledWith("t1", "https://example.com/");
    expect(features.gestures.zoom).toHaveBeenCalledWith("t1", -1);
    expect(features.media.report).toHaveBeenCalledWith("t1", page, true);
    expect(features.translator.pageReady).toHaveBeenCalledWith("t1", page);
    expect(features.annotator.pageReady).toHaveBeenCalledWith("t1", page);
    expect(hooks.translation?.("t1")).toBeNull();
  });
});
