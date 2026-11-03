import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { WindowRegistry } from "./window-registry";

class FakeContents extends EventEmitter {
  constructor(readonly id: number) {
    super();
  }
}

describe("WindowRegistry", () => {
  it("finds a window by its chrome UI, and by any of its UIs", () => {
    const registry = new WindowRegistry<string>();
    const chrome = new FakeContents(1);
    const overlay = new FakeContents(2);
    registry.add(chrome, "first");
    registry.registerUi(overlay, "first");
    registry.add(new FakeContents(3), "second");
    expect(registry.fromChrome(1)).toBe("first");
    expect(registry.fromChrome(2)).toBeUndefined();
    expect(registry.fromUi(2)).toBe("first");
    expect(registry.size).toBe(2);
    expect(registry.all()).toEqual(["first", "second"]);
  });

  it("never lets an unknown webContents (a tab page) through", () => {
    const registry = new WindowRegistry<string>();
    registry.add(new FakeContents(1), "first");
    expect(registry.fromUi(42)).toBeUndefined();
  });

  it("drops a UI when its webContents is destroyed, and a window when it closes", () => {
    const registry = new WindowRegistry<string>();
    const chrome = new FakeContents(1);
    const overlay = new FakeContents(2);
    registry.add(chrome, "first");
    registry.registerUi(overlay, "first");
    overlay.emit("destroyed");
    expect(registry.fromUi(2)).toBeUndefined();
    expect(registry.fromUi(1)).toBe("first");
    registry.remove(1);
    expect(registry.fromChrome(1)).toBeUndefined();
    expect(registry.size).toBe(0);
    chrome.emit("destroyed");
    expect(registry.fromUi(1)).toBeUndefined();
  });
});
