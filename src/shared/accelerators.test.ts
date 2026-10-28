import { describe, expect, it } from "vitest";
import {
  acceleratorFromKeyPress,
  acceleratorKeys,
  acceleratorProblem,
  acceleratorText,
  isReservedAnywhere,
  normalizeAccelerator,
  parseAccelerator,
  resolveAccelerator,
  sameAccelerator,
  type KeyPress,
} from "./accelerators";
import {
  assignShortcut,
  checkShortcut,
  effectiveAccelerator,
  effectiveAliases,
  findShortcutConflict,
  COMMANDS,
  COMMAND_GROUPS,
} from "./commands";

const press = (key: string, code: string, modifiers: Partial<KeyPress> = {}): KeyPress => ({
  key,
  code,
  control: false,
  alt: false,
  shift: false,
  meta: false,
  ...modifiers,
});

describe("accelerator parsing", () => {
  it("normalizes modifier names, order and key case", () => {
    expect(normalizeAccelerator("shift+cmdorctrl+k")).toBe("CmdOrCtrl+Shift+K");
    expect(normalizeAccelerator("Alt+Command+i")).toBe("Cmd+Alt+I");
    expect(normalizeAccelerator("Control+Option+Meta+Up")).toBe("Super+Ctrl+Alt+Up");
    expect(normalizeAccelerator("CommandOrControl+Return")).toBe("CmdOrCtrl+Enter");
    expect(normalizeAccelerator("Ctrl+esc")).toBe("Ctrl+Escape");
    expect(normalizeAccelerator("f5")).toBe("F5");
  });

  it("reads the Plus key and punctuation", () => {
    expect(normalizeAccelerator("CmdOrCtrl++")).toBe("CmdOrCtrl+Plus");
    expect(normalizeAccelerator("CmdOrCtrl+=")).toBe("CmdOrCtrl+=");
    expect(normalizeAccelerator("CmdOrCtrl+Shift+\\")).toBe("CmdOrCtrl+Shift+\\");
    expect(parseAccelerator("CmdOrCtrl+-")).toEqual({ modifiers: ["CmdOrCtrl"], key: "-" });
  });

  it("rejects malformed accelerators", () => {
    for (const bad of ["", "Ctrl+", "Ctrl+Ctrl+A", "Hyper+A", "Ctrl+AB", "Ctrl+F25", "Ctrl+é", 42, null, "A".repeat(80)]) {
      expect(normalizeAccelerator(bad)).toBeNull();
    }
  });
});

describe("accelerators per platform", () => {
  it("resolves CmdOrCtrl to Cmd on macOS and Ctrl elsewhere", () => {
    expect(resolveAccelerator("CmdOrCtrl+Shift+T", "darwin")).toBe("Shift+Meta+T");
    expect(resolveAccelerator("CmdOrCtrl+Shift+T", "linux")).toBe("Ctrl+Shift+T");
    expect(sameAccelerator("CmdOrCtrl+T", "Ctrl+T", "linux")).toBe(true);
    expect(sameAccelerator("CmdOrCtrl+T", "Ctrl+T", "darwin")).toBe(false);
    expect(sameAccelerator("Cmd+T", "Super+T", "darwin")).toBe(true);
  });

  it("formats keys per platform", () => {
    expect(acceleratorKeys("CmdOrCtrl+Shift+C", "darwin")).toEqual(["⇧", "⌘", "C"]);
    expect(acceleratorKeys("Ctrl+Alt+Shift+Cmd+X", "darwin")).toEqual(["⌃", "⌥", "⇧", "⌘", "X"]);
    expect(acceleratorText("CmdOrCtrl+Shift+B", "linux")).toBe("Ctrl+Maj+B");
    expect(acceleratorText("Super+E", "win32")).toBe("Win+E");
    expect(acceleratorText("Ctrl+Backspace", "linux")).toBe("Ctrl+Retour arrière");
  });

  it("refuses OS keys and bare keys, accepts F-keys alone", () => {
    expect(acceleratorProblem("Ctrl+Alt+Delete", "win32")).toBe("reserved");
    expect(acceleratorProblem("Alt+F4", "linux")).toBe("reserved");
    expect(acceleratorProblem("CmdOrCtrl+Q", "darwin")).toBe("reserved");
    expect(acceleratorProblem("CmdOrCtrl+Q", "linux")).toBeNull();
    expect(acceleratorProblem("Shift+A", "linux")).toBe("needs-modifier");
    expect(acceleratorProblem("A", "linux")).toBe("needs-modifier");
    expect(acceleratorProblem("F7", "linux")).toBeNull();
    expect(acceleratorProblem("Ctrl+nope", "linux")).toBe("invalid");
    expect(isReservedAnywhere("CmdOrCtrl+Q")).toBe(true);
    expect(isReservedAnywhere("Ctrl+Q")).toBe(false);
  });
});

describe("capturing a key press", () => {
  it("names the physical key, whatever Shift or Alt typed", () => {
    expect(acceleratorFromKeyPress(press("Y", "KeyY", { control: true, shift: true }), "linux")).toBe("Ctrl+Shift+Y");
    expect(acceleratorFromKeyPress(press("¥", "KeyY", { alt: true, meta: true }), "darwin")).toBe("Cmd+Alt+Y");
    expect(acceleratorFromKeyPress(press("!", "Digit1", { control: true, shift: true }), "linux")).toBe("Ctrl+Shift+1");
    expect(acceleratorFromKeyPress(press("+", "Equal", { control: true, shift: true }), "linux")).toBe("Ctrl+Shift+=");
    expect(acceleratorFromKeyPress(press("ArrowLeft", "ArrowLeft", { alt: true }), "win32")).toBe("Alt+Left");
    expect(acceleratorFromKeyPress(press("e", "KeyE", { meta: true }), "linux")).toBe("Super+E");
    expect(acceleratorFromKeyPress(press("F2", "F2"), "linux")).toBe("F2");
  });

  it("waits while only modifiers are held", () => {
    expect(acceleratorFromKeyPress(press("Control", "ControlLeft", { control: true }), "linux")).toBeNull();
    expect(acceleratorFromKeyPress(press("Shift", "ShiftLeft", { shift: true }), "darwin")).toBeNull();
  });
});

describe("user shortcuts", () => {
  it("prefers the user's choice, null meaning none", () => {
    expect(effectiveAccelerator("new-tab", "linux")).toBe("CmdOrCtrl+T");
    expect(effectiveAccelerator("new-tab", "linux", { "new-tab": "Ctrl+Shift+Y" })).toBe("Ctrl+Shift+Y");
    expect(effectiveAccelerator("new-tab", "linux", { "new-tab": null })).toBeUndefined();
  });

  it("finds conflicts on the resolved keys", () => {
    expect(findShortcutConflict("Ctrl+N", "new-tab", "linux")).toBe("new-window");
    expect(findShortcutConflict("Ctrl+N", "new-tab", "darwin")).toBeNull();
    expect(findShortcutConflict("Ctrl+N", "new-tab", "linux", { "new-window": null })).toBeNull();
    expect(findShortcutConflict("Ctrl+N", "new-window", "linux")).toBeNull();
  });

  it("checks a candidate: OS keys, fixed app keys, conflicts", () => {
    expect(checkShortcut("new-tab", "Ctrl+Alt+Delete", "linux")).toEqual({ ok: false, reason: "reserved" });
    expect(checkShortcut("new-tab", "Ctrl+C", "linux")).toEqual({ ok: false, reason: "fixed", label: "Copier" });
    expect(checkShortcut("new-tab", "Ctrl+1", "linux")).toEqual({ ok: false, reason: "fixed", label: "Onglet 1" });
    expect(checkShortcut("new-tab", "Ctrl+N", "linux")).toEqual({ ok: true, accelerator: "Ctrl+N", conflict: "new-window" });
    expect(checkShortcut("new-tab", "ctrl+shift+y", "linux")).toEqual({ ok: true, accelerator: "Ctrl+Shift+Y", conflict: null });
  });

  it("assigns: the other command loses it, a default choice drops the entry", () => {
    expect(assignShortcut({}, "new-tab", "Ctrl+N", "linux")).toEqual({ "new-tab": "Ctrl+N", "new-window": null });
    expect(assignShortcut({ "new-tab": "Ctrl+Shift+Y" }, "new-tab", "Ctrl+T", "linux")).toEqual({});
    expect(assignShortcut({}, "new-tab", null, "linux")).toEqual({ "new-tab": null });
    expect(assignShortcut({}, "devtools", null, "linux")).toEqual({ devtools: null });
    expect(assignShortcut({}, "picture-in-picture", null, "linux")).toEqual({});
  });

  it("drops a command's aliases once it is customized, or when another command takes them", () => {
    expect(effectiveAliases("reload", "linux")).toEqual(["F5"]);
    expect(effectiveAliases("reload", "linux", { reload: "Ctrl+Shift+R" })).toEqual([]);
    expect(effectiveAliases("reload", "linux", { "sync-now": "F5" })).toEqual([]);
    expect(effectiveAliases("find-next", "darwin")).toEqual([]);
  });

  it("groups every command exactly once", () => {
    const grouped = COMMAND_GROUPS.flatMap((group) => group.ids);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(COMMANDS.map((command) => command.id).sort());
  });
});
