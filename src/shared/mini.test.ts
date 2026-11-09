import { describe, expect, it } from "vitest";
import { MINI_BAR_HEIGHT, MINI_GUTTER, miniLayout, miniShortcut, opensInMiniWindow } from "./mini";

const key = (k: string, mods: Partial<{ control: boolean; meta: boolean; alt: boolean; shift: boolean }> = {}) => ({
  type: "keyDown",
  key: k,
  control: false,
  meta: false,
  alt: false,
  shift: false,
  ...mods,
});

describe("mini window", () => {
  it("puts the bar on top and the page below, inset", () => {
    expect(miniLayout(900, 700)).toEqual({
      bar: { x: 0, y: 0, width: 900, height: MINI_BAR_HEIGHT },
      page: { x: MINI_GUTTER, y: MINI_BAR_HEIGHT, width: 900 - 2 * MINI_GUTTER, height: 700 - MINI_BAR_HEIGHT - MINI_GUTTER },
    });
    expect(miniLayout(4, 10).page).toEqual({ x: MINI_GUTTER, y: MINI_BAR_HEIGHT, width: 0, height: 0 });
  });

  it("takes one web link, with the setting on", () => {
    expect(opensInMiniWindow(["https://example.com/"], true)).toBe(true);
    expect(opensInMiniWindow(["https://example.com/"], false)).toBe(false);
    expect(opensInMiniWindow(["https://a.example/", "https://b.example/"], true)).toBe(false);
    expect(opensInMiniWindow(["file:///home/me/doc.pdf"], true)).toBe(false);
  });

  it("knows its shortcuts per platform", () => {
    expect(miniShortcut(key("o", { control: true }), false)).toBe("promote");
    expect(miniShortcut(key("O", { meta: true }), true)).toBe("promote");
    expect(miniShortcut(key("w", { control: true }), false)).toBe("close");
    expect(miniShortcut(key("o", { meta: true }), false)).toBeNull();
    expect(miniShortcut(key("o", { control: true, shift: true }), false)).toBeNull();
    expect(miniShortcut({ ...key("o", { control: true }), type: "keyUp" }, false)).toBeNull();
  });
});
