import { describe, expect, it } from "vitest";
import { MAX_ZOOM_HOSTS, SiteZoom, nextZoomFactor } from "./levels";

describe("nextZoomFactor", () => {
  it("steps through Chrome's levels", () => {
    expect(nextZoomFactor(1, 1)).toBe(1.1);
    expect(nextZoomFactor(1, -1)).toBe(0.9);
    expect(nextZoomFactor(1.25, 1)).toBe(1.5);
    // From an off-step factor, the next step in that direction.
    expect(nextZoomFactor(1.17, 1)).toBe(1.25);
    expect(nextZoomFactor(1.17, -1)).toBe(1.1);
  });

  it("stops at the ends, and resets to the given default", () => {
    expect(nextZoomFactor(5, 1)).toBeUndefined();
    expect(nextZoomFactor(0.25, -1)).toBeUndefined();
    expect(nextZoomFactor(2, 0)).toBe(1);
    expect(nextZoomFactor(2, 0, 1.25)).toBe(1.25);
  });
});

describe("SiteZoom", () => {
  it("remembers a factor per host, the default elsewhere", () => {
    const zoom = new SiteZoom();
    expect(zoom.set("example.com", 1.25, 1)).toBe(true);
    expect(zoom.factorFor("example.com", 1)).toBe(1.25);
    expect(zoom.factorFor("other.org", 1)).toBe(1);
    expect(zoom.factorFor("other.org", 0.9)).toBe(0.9);
  });

  it("forgets a host zoomed back to the default, so the default applies if it changes later", () => {
    const zoom = new SiteZoom({ "example.com": 1.5 });
    expect(zoom.set("example.com", 1, 1)).toBe(true);
    expect(zoom.get("example.com")).toBeUndefined();
    expect(zoom.factorFor("example.com", 1.1)).toBe(1.1);
    expect(zoom.set("example.com", 1, 1)).toBe(false);
  });

  it("reports unchanged factors and rejects invalid ones", () => {
    const zoom = new SiteZoom();
    zoom.set("a.com", 1.5, 1);
    expect(zoom.set("a.com", 1.5, 1)).toBe(false);
    expect(zoom.set("a.com", 9, 1)).toBe(false);
    expect(zoom.set("a.com", Number.NaN, 1)).toBe(false);
    expect(zoom.set("", 1.5, 1)).toBe(false);
    expect(zoom.get("a.com")).toBe(1.5);
  });

  it("parses stored data, dropping invalid entries", () => {
    expect(SiteZoom.parse({ "Example.com": 1.25, "bad.com": "big", "huge.com": 50, "": 2 })).toEqual({ "example.com": 1.25 });
    expect(SiteZoom.parse([])).toBeNull();
    expect(SiteZoom.parse(null)).toBeNull();
    const zoom = new SiteZoom({ "a.com": 0.8 });
    expect(new SiteZoom(SiteZoom.parse(JSON.parse(JSON.stringify(zoom)))!).get("a.com")).toBe(0.8);
  });

  it(`keeps the ${MAX_ZOOM_HOSTS} most recently zoomed hosts`, () => {
    const zoom = new SiteZoom();
    for (let i = 0; i <= MAX_ZOOM_HOSTS; i++) zoom.set(`host${i}.com`, 1.5, 1);
    expect(zoom.size).toBe(MAX_ZOOM_HOSTS);
    expect(zoom.get("host0.com")).toBeUndefined();
    // Re-zooming moves a host to the most recent end.
    zoom.set("host1.com", 2, 1);
    zoom.set("new.com", 2, 1);
    expect(zoom.get("host1.com")).toBe(2);
    expect(zoom.get("host2.com")).toBeUndefined();
  });
});
