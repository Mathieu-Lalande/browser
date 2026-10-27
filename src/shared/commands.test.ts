import { describe, expect, it } from "vitest";
import { COMMANDS, commandAccelerator, commandLabel, getCommand, isCommandAvailable, isCommandId, shortcutKeys } from "./commands";
import type { TabState } from "./types";

const tab = (overrides: Partial<TabState> = {}): TabState => ({
  id: "t1",
  url: "https://example.com/",
  title: "Example",
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
  lastActiveAt: 0,
  isAudible: false,
  isMuted: false,
  zoom: 100,
  find: null,
  blockedPopup: null,
  ...overrides,
});

describe("command registry", () => {
  it("has unique ids and, per platform, unique accelerators", () => {
    expect(new Set(COMMANDS.map((command) => command.id)).size).toBe(COMMANDS.length);
    for (const platform of ["darwin", "linux"]) {
      const accelerators = COMMANDS.map((command) => commandAccelerator(command, platform)).filter(Boolean);
      expect(new Set(accelerators).size).toBe(accelerators.length);
    }
  });

  it("gives every command a label and keywords", () => {
    for (const command of COMMANDS) {
      expect(command.label.trim()).not.toBe("");
      expect(command.keywords.length).toBeGreaterThan(0);
    }
  });

  it("validates ids received over IPC", () => {
    expect(isCommandId("duplicate-tab")).toBe(true);
    expect(isCommandId("toString")).toBe(false);
    expect(isCommandId("nope")).toBe(false);
    expect(isCommandId(42)).toBe(false);
  });

  it("keeps the shortcuts the menu always had", () => {
    expect(getCommand("new-tab").accelerator).toBe("CmdOrCtrl+T");
    expect(getCommand("copy-url").accelerator).toBe("CmdOrCtrl+Shift+C");
    expect(getCommand("command-palette").accelerator).toBe("CmdOrCtrl+K");
    expect(commandAccelerator(getCommand("devtools"), "darwin")).toBe("Alt+Cmd+I");
    expect(commandAccelerator(getCommand("back"), "win32")).toBe("Alt+Left");
  });

  it("uses each platform's shortcuts for find, downloads and mute", () => {
    expect(commandAccelerator(getCommand("find"), "linux")).toBe("CmdOrCtrl+F");
    expect(commandAccelerator(getCommand("find-next"), "linux")).toBe("F3");
    expect(commandAccelerator(getCommand("find-previous"), "win32")).toBe("Shift+F3");
    expect(commandAccelerator(getCommand("find-next"), "darwin")).toBe("Cmd+G");
    expect(commandAccelerator(getCommand("open-downloads"), "linux")).toBe("Ctrl+Shift+J");
    expect(commandAccelerator(getCommand("open-downloads"), "darwin")).toBe("Alt+Cmd+L");
    // Not Cmd+M: that minimizes the window on macOS.
    expect(commandAccelerator(getCommand("toggle-mute"), "darwin")).toBe("Ctrl+M");
  });

  it("labels the mute toggle after the tab's sound", () => {
    const mute = getCommand("toggle-mute");
    expect(commandLabel(mute, { activeTab: tab() })).toBe("Couper le son de l'onglet");
    expect(commandLabel(mute, { activeTab: tab({ isMuted: true }) })).toBe("Réactiver le son de l'onglet");
    expect(isCommandAvailable(getCommand("find-next"), { activeTab: tab() })).toBe(false);
    expect(isCommandAvailable(getCommand("picture-in-picture"), { activeTab: tab({ url: "" }) })).toBe(false);
  });

  it("labels toggles after the active tab's state", () => {
    const pin = getCommand("toggle-pin");
    expect(commandLabel(pin, { activeTab: tab() })).toBe("Épingler l'onglet");
    expect(commandLabel(pin, { activeTab: tab({ isPinned: true }) })).toBe("Désépingler l'onglet");
    expect(commandLabel(getCommand("toggle-bookmark"), { activeTab: tab({ isBookmarked: true }) })).toBe("Retirer des favoris");
    expect(commandLabel(getCommand("reload"), {})).toBe("Actualiser");
  });

  it("only offers page commands when a page is shown", () => {
    const startPage = { activeTab: tab({ url: "" }) };
    expect(isCommandAvailable(getCommand("copy-url"), startPage)).toBe(false);
    expect(isCommandAvailable(getCommand("copy-url"), { activeTab: tab() })).toBe(true);
    expect(isCommandAvailable(getCommand("new-tab"), startPage)).toBe(true);
    expect(isCommandAvailable(getCommand("back"), { activeTab: tab() })).toBe(false);
    expect(isCommandAvailable(getCommand("back"), { activeTab: tab({ canGoBack: true }) })).toBe(true);
    // The palette does not list itself.
    expect(isCommandAvailable(getCommand("command-palette"), { activeTab: tab() })).toBe(false);
  });
});

describe("shortcutKeys", () => {
  it("uses symbols in macOS order", () => {
    expect(shortcutKeys("CmdOrCtrl+Shift+C", "darwin")).toEqual(["⇧", "⌘", "C"]);
    expect(shortcutKeys("Alt+Cmd+I", "darwin")).toEqual(["⌥", "⌘", "I"]);
  });

  it("uses French key names elsewhere", () => {
    expect(shortcutKeys("CmdOrCtrl+Shift+C", "linux")).toEqual(["Ctrl", "Maj", "C"]);
    expect(shortcutKeys("Alt+Left", "win32")).toEqual(["Alt", "←"]);
    expect(shortcutKeys("CmdOrCtrl+=", "linux")).toEqual(["Ctrl", "+"]);
    expect(shortcutKeys("CmdOrCtrl+-", "linux")).toEqual(["Ctrl", "-"]);
    expect(shortcutKeys("CmdOrCtrl+Plus", "linux")).toEqual(["Ctrl", "+"]);
  });
});
