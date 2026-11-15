import { describe, expect, it } from "vitest";
import { checkExtensionShortcut, extensionAcceleratorProblem, extensionShortcuts, sanitizeUserShortcuts, withUserShortcut, type ShortcutSource } from "./extension-commands";

const manifest = (commands: Record<string, unknown>) => ({ manifest_version: 3, commands });
const source = (id: string, commands: Record<string, unknown>, userShortcuts?: Record<string, string>): ShortcutSource => ({ id, name: id.toUpperCase(), manifest: manifest(commands), userShortcuts });
const names = new Map([
  ["one", "ONE"],
  ["two", "TWO"],
]);

describe("extension shortcut editor (ADR-057)", () => {
  it("installs the key the user chose, and clears one on request", () => {
    const shortcuts = extensionShortcuts(
      [source("one", { a: { suggested_key: "Alt+Shift+A", description: "A" }, b: { suggested_key: "Alt+Shift+B" }, c: {} }, { a: "Alt+Shift+K", b: "", c: "Ctrl+Shift+L" })],
      "linux",
    );
    expect(shortcuts.find((s) => s.command === "a")).toMatchObject({ accelerator: "Alt+Shift+K", active: true, custom: true, description: "A" });
    expect(shortcuts.find((s) => s.command === "b")).toMatchObject({ accelerator: null, active: false, custom: true, issue: null });
    expect(shortcuts.find((s) => s.command === "c")).toMatchObject({ accelerator: "Ctrl+Shift+L", active: true, custom: true });
  });

  it("gives the user's keys priority over the suggestions of earlier extensions, never over the browser's", () => {
    const shortcuts = extensionShortcuts(
      [source("one", { a: { suggested_key: "Alt+Shift+K" } }), source("two", { b: {}, c: {} }, { b: "Alt+Shift+K", c: "Ctrl+T" })],
      "linux",
    );
    expect(shortcuts.find((s) => s.command === "b")).toMatchObject({ active: true, custom: true });
    expect(shortcuts.find((s) => s.command === "a")).toMatchObject({ active: false, issue: { kind: "extension", name: "TWO" } });
    expect(shortcuts.find((s) => s.command === "c")).toMatchObject({ active: false, issue: { kind: "browser" } });
  });

  it("does not count the user's keys in the four suggested ones", () => {
    const commands = Object.fromEntries(["1", "2", "3", "4", "5"].map((n) => [`c${n}`, { suggested_key: `Alt+Shift+${n}` }]));
    const shortcuts = extensionShortcuts([source("one", { ...commands, mine: {} }, { mine: "Alt+Shift+9" })], "linux");
    expect(shortcuts.filter((s) => s.active)).toHaveLength(5);
    expect(shortcuts.find((s) => s.command === "c5")?.issue).toEqual({ kind: "limit" });
  });

  it("checks a pressed key against the browser and the other extensions", () => {
    const current = extensionShortcuts([source("one", { a: { suggested_key: "Alt+Shift+A" } }), source("two", { b: {} })], "linux");
    expect(checkExtensionShortcut("two", "b", "Alt+Shift+A", "linux", {}, current, names)).toEqual({ ok: false, issue: { kind: "extension", name: "ONE" } });
    expect(checkExtensionShortcut("one", "a", "Alt+Shift+A", "linux", {}, current, names)).toEqual({ ok: true, accelerator: "Alt+Shift+A" });
    expect(checkExtensionShortcut("two", "b", "Ctrl+T", "linux", {}, current, names)).toMatchObject({ ok: false, issue: { kind: "browser" } });
    // The browser's own shortcuts as the user set them (ADR-028): a freed key becomes available.
    expect(checkExtensionShortcut("two", "b", "Ctrl+T", "linux", { "new-tab": "Ctrl+Shift+F12" }, current, names)).toEqual({ ok: true, accelerator: "Ctrl+T" });
    expect(checkExtensionShortcut("two", "b", "Shift+B", "linux", {}, current, names)).toEqual({ ok: false, issue: { kind: "invalid" } });
    expect(checkExtensionShortcut("two", "b", "Ctrl+Alt+B", "linux", {}, current, names)).toEqual({ ok: false, issue: { kind: "invalid" } });
    expect(checkExtensionShortcut("two", "b", "Alt+F4", "win32", {}, current, names)).toEqual({ ok: false, issue: { kind: "reserved" } });
  });

  it("applies Chrome's modifier rules per platform", () => {
    expect(extensionAcceleratorProblem("Cmd+Shift+Y", "darwin")).toBeNull();
    expect(extensionAcceleratorProblem("Super+Y", "linux")).toBe("invalid");
    expect(extensionAcceleratorProblem("F7", "linux")).toBe("invalid");
    expect(extensionAcceleratorProblem("Alt+Shift+Y", "linux")).toBeNull();
  });

  it("stores and edits the user's choices safely", () => {
    expect(sanitizeUserShortcuts({ a: "alt+shift+k", b: "", c: "nope+", d: 3, "": "Alt+K" })).toEqual({ a: "Alt+Shift+K", b: "" });
    expect(sanitizeUserShortcuts("x")).toBeUndefined();
    expect(withUserShortcut(undefined, "a", "Alt+Shift+K")).toEqual({ a: "Alt+Shift+K" });
    expect(withUserShortcut({ a: "Alt+Shift+K" }, "a", "")).toEqual({ a: "" });
    expect(withUserShortcut({ a: "Alt+Shift+K" }, "a", null)).toBeUndefined();
  });
});
