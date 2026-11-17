import { describe, expect, it } from "vitest";
import { desktopEntry, icoFromPng, parseAppSwitch, shortcutName, webAppArgs } from "./web-apps";

describe("web apps", () => {
  it("reads the --app switch, web pages only", () => {
    expect(parseAppSwitch(["browser.exe", "--app=https://web.whatsapp.com/"])).toBe("https://web.whatsapp.com/");
    expect(parseAppSwitch(["browser.exe", "--app=file:///C:/x"])).toBeNull();
    expect(parseAppSwitch(["browser.exe", "https://example.com"])).toBeNull();
  });

  it("names shortcuts after the page, safely", () => {
    expect(shortcutName("Notion – Votre espace", "https://www.notion.so/")).toBe("Notion");
    expect(shortcutName('a<b>:"c"|?*', "https://x.com/")).toBe("a b c");
    expect(shortcutName("", "https://www.figma.com/files")).toBe("figma.com");
  });

  it("builds arguments, an ICO around a PNG and a Linux entry", () => {
    expect(webAppArgs("https://a.b/", { appPath: "C:\\app", profile: "work" })).toEqual(["C:\\app", "--profile=work", "--app=https://a.b/"]);
    const ico = icoFromPng(new Uint8Array([1, 2, 3]), 64);
    expect([...ico.slice(0, 8)]).toEqual([0, 0, 1, 0, 1, 0, 64, 64]);
    expect(ico.length).toBe(25);
    expect(desktopEntry("My App", "/opt/browser", ["--app=https://a.b/"], "/tmp/i.png")).toContain('Exec=/opt/browser --app=https://a.b/');
  });
});
