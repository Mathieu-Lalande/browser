import { describe, expect, it } from "vitest";
import { darkSiteOf, toggleDarkSite, wantsDarkPage } from "./dark-pages";

describe("dark pages", () => {
  it("follows the global switch, flipped per site", () => {
    expect(wantsDarkPage("off", [], "example.com", true)).toBe(false);
    expect(wantsDarkPage("on", [], "example.com", false)).toBe(true);
    expect(wantsDarkPage("auto", [], "example.com", true)).toBe(true);
    expect(wantsDarkPage("auto", [], "example.com", false)).toBe(false);
    expect(wantsDarkPage("off", ["example.com"], "www.example.com", false)).toBe(true);
    expect(wantsDarkPage("on", ["example.com"], "example.com", false)).toBe(false);
    expect(wantsDarkPage("on", [], "", false)).toBe(false);
  });

  it("toggles a site by its host without www", () => {
    expect(darkSiteOf("WWW.Example.com")).toBe("example.com");
    expect(toggleDarkSite([], "www.example.com")).toEqual(["example.com"]);
    expect(toggleDarkSite(["example.com"], "example.com")).toEqual([]);
  });
});
