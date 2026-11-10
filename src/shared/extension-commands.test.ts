import { describe, expect, it } from "vitest";
import {
  browserShortcutLabel,
  chromeShortcutText,
  chromeShortcutToAccelerator,
  declaredCommands,
  extensionShortcuts,
  isExecuteAction,
  suggestedKey,
} from "./extension-commands";

const manifest = (commands: Record<string, unknown>) => ({ manifest_version: 3, commands });

describe("chromeShortcutToAccelerator", () => {
  it("converts Chrome's syntax per platform (Ctrl is Command on macOS, MacCtrl the real Control)", () => {
    expect(chromeShortcutToAccelerator("Ctrl+Shift+Y", "linux")).toBe("Ctrl+Shift+Y");
    expect(chromeShortcutToAccelerator("Ctrl+Shift+Y", "darwin")).toBe("Cmd+Shift+Y");
    expect(chromeShortcutToAccelerator("MacCtrl+Shift+Y", "darwin")).toBe("Ctrl+Shift+Y");
    expect(chromeShortcutToAccelerator("Command+Shift+Y", "darwin")).toBe("Cmd+Shift+Y");
    expect(chromeShortcutToAccelerator("Alt+Shift+P", "win32")).toBe("Alt+Shift+P");
    expect(chromeShortcutToAccelerator("Ctrl+Shift+Comma", "linux")).toBe("Ctrl+Shift+,");
    expect(chromeShortcutToAccelerator("Alt+Period", "linux")).toBe("Alt+.");
    expect(chromeShortcutToAccelerator("Ctrl+Up", "linux")).toBe("Ctrl+Up");
    expect(chromeShortcutToAccelerator("ctrl+shift+y", "linux")).toBe("Ctrl+Shift+Y");
  });

  it("refuses what Chrome refuses", () => {
    expect(chromeShortcutToAccelerator("Shift+Y", "linux")).toBeNull();
    expect(chromeShortcutToAccelerator("Y", "linux")).toBeNull();
    expect(chromeShortcutToAccelerator("Ctrl+Alt+Y", "linux")).toBeNull();
    expect(chromeShortcutToAccelerator("Command+Y", "linux")).toBeNull();
    expect(chromeShortcutToAccelerator("MacCtrl+Y", "win32")).toBeNull();
    expect(chromeShortcutToAccelerator("Ctrl+Ctrl+Y", "linux")).toBeNull();
    expect(chromeShortcutToAccelerator("Ctrl+F5", "linux")).toBeNull();
    expect(chromeShortcutToAccelerator("MediaPlayPause", "linux")).toBeNull();
    expect(chromeShortcutToAccelerator(42, "linux")).toBeNull();
  });
});

describe("suggestedKey / declaredCommands", () => {
  it("reads the platform's own key, else the default", () => {
    const keys = { default: "Ctrl+Shift+Y", mac: "Command+Shift+U", windows: "Alt+Shift+W" };
    expect(suggestedKey(keys, "darwin")).toBe("Command+Shift+U");
    expect(suggestedKey(keys, "win32")).toBe("Alt+Shift+W");
    expect(suggestedKey(keys, "linux")).toBe("Ctrl+Shift+Y");
    expect(suggestedKey("Alt+J", "linux")).toBe("Alt+J");
    expect(suggestedKey(undefined, "linux")).toBeNull();
  });

  it("lists the commands in order with their description", () => {
    expect(declaredCommands(manifest({ a: { description: "A", suggested_key: { default: "Alt+A" } }, b: {} }), "linux")).toEqual([
      { name: "a", description: "A", suggested: "Alt+A" },
      { name: "b", description: "", suggested: null },
    ]);
    expect(declaredCommands({ commands: [] }, "linux")).toEqual([]);
    expect(declaredCommands(null, "linux")).toEqual([]);
  });
});

describe("extensionShortcuts", () => {
  const one = (commands: Record<string, unknown>, id = "one", name = "One") => ({ id, name, manifest: manifest(commands) });

  it("installs a free shortcut and names _execute_action", () => {
    const [action, other] = extensionShortcuts([one({ _execute_action: { suggested_key: { default: "Ctrl+Shift+Y" } }, hello: { description: "Bonjour", suggested_key: "Alt+Shift+P" } })], "linux");
    expect(action).toMatchObject({ extensionId: "one", command: "_execute_action", accelerator: "Ctrl+Shift+Y", active: true, issue: null });
    expect(action.description).not.toBe("");
    expect(other).toMatchObject({ command: "hello", description: "Bonjour", accelerator: "Alt+Shift+P", active: true });
    expect(isExecuteAction("_execute_browser_action")).toBe(true);
    expect(isExecuteAction("hello")).toBe(false);
  });

  it("lets browser shortcuts win, including the user's own and the fixed ones", () => {
    const [taken] = extensionShortcuts([one({ a: { suggested_key: "Ctrl+T" } })], "linux");
    expect(taken.active).toBe(false);
    expect(taken.issue).toMatchObject({ kind: "browser" });
    // The user moved "new tab" elsewhere: Ctrl+T is free; but now Ctrl+Shift+Y is the browser's.
    const overrides = { "new-tab": "Ctrl+Shift+Y" } as const;
    const [freed, blocked] = extensionShortcuts([one({ a: { suggested_key: "Ctrl+T" }, b: { suggested_key: "Ctrl+Shift+Y" } })], "linux", overrides);
    expect(freed.active).toBe(true);
    expect(blocked.issue).toMatchObject({ kind: "browser" });
    // Tab numbers and F5-like aliases are browser shortcuts too.
    expect(browserShortcutLabel("Ctrl+1", "linux")).not.toBeNull();
    expect(browserShortcutLabel("Ctrl+Plus", "linux")).not.toBeNull();
    expect(browserShortcutLabel("Alt+Shift+P", "linux")).toBeNull();
  });

  it("gives a shortcut to the extension installed first, four per extension at most", () => {
    const shortcuts = extensionShortcuts(
      [
        one({ a: { suggested_key: "Alt+Shift+1" } }, "first", "First"),
        one(
          {
            a: { suggested_key: "Alt+Shift+1" },
            b: { suggested_key: "Alt+Shift+2" },
            c: { suggested_key: "Alt+Shift+3" },
            d: { suggested_key: "Alt+Shift+4" },
            e: { suggested_key: "Alt+Shift+5" },
            f: { suggested_key: "Alt+Shift+6" },
          },
          "second",
          "Second",
        ),
      ],
      "linux",
    );
    const second = shortcuts.filter((shortcut) => shortcut.extensionId === "second");
    expect(second[0].issue).toEqual({ kind: "extension", name: "First" });
    expect(second.filter((shortcut) => shortcut.active).map((shortcut) => shortcut.command)).toEqual(["b", "c", "d", "e"]);
    expect(second[5].issue).toEqual({ kind: "limit" });
  });

  it("reports invalid and reserved keys, and commands without a key", () => {
    const [invalid, reserved, none] = extensionShortcuts([one({ a: { suggested_key: "Shift+A" }, b: { suggested_key: "Command+Shift+3" }, c: { description: "C" } })], "darwin");
    expect(invalid.issue).toEqual({ kind: "invalid" });
    expect(reserved.issue).toEqual({ kind: "reserved" });
    expect(none).toMatchObject({ accelerator: null, active: false, issue: null });
  });
});

describe("chromeShortcutText", () => {
  it("spells the shortcut as Chrome reports it", () => {
    expect(chromeShortcutText("Ctrl+Shift+Y", "linux")).toBe("Ctrl+Shift+Y");
    expect(chromeShortcutText("Alt+,", "win32")).toBe("Alt+Comma");
    expect(chromeShortcutText("Cmd+Shift+Y", "darwin")).toBe("⇧⌘Y");
    expect(chromeShortcutText("Ctrl+Alt+Y", "darwin")).toBe("⌃⌥Y");
    expect(chromeShortcutText("nope+", "linux")).toBe("");
  });
});
