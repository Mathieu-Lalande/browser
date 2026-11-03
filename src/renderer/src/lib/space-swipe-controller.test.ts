import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PEEK_GAP, SETTLE_MS, SpaceSwipeController, type SpaceSwipeHost } from "./space-swipe-controller.svelte";

function setup(overrides: Partial<SpaceSwipeHost> = {}) {
  const switchTo = vi.fn();
  const controller = new SpaceSwipeController({
    neighbours: () => ({ previous: { id: "p" }, next: { id: "n" } }),
    reduceMotion: () => false,
    switchTo,
    blocked: () => false,
    onLift: () => {},
    ...overrides,
  });
  controller.trackWidth = 200;
  return { controller, switchTo };
}

describe("SpaceSwipeController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("follows the fingers and reports the progress toward a neighbour", () => {
    const { controller } = setup();
    controller.apply({ kind: "track", offset: -(200 + PEEK_GAP) / 2 });
    expect(controller.swiping).toBe(true);
    expect(controller.settling).toBe(false);
    expect(controller.progress).toBeCloseTo(0.5);
    controller.apply({ kind: "track", offset: 10_000 });
    expect(controller.progress).toBe(-1);
  });

  it("reports no progress toward a missing neighbour", () => {
    const { controller } = setup({ neighbours: () => ({ next: { id: "n" } }) });
    controller.apply({ kind: "track", offset: 50 });
    expect(controller.progress).toBe(0);
  });

  it("slides to the neighbour, then switches, and lands without a slide of its own", () => {
    const { controller, switchTo } = setup();
    controller.apply({ kind: "track", offset: -120 });
    controller.apply({ kind: "commit", direction: 1 });
    expect(controller.settling).toBe(true);
    expect(controller.offset).toBe(-(200 + PEEK_GAP));
    expect(switchTo).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SETTLE_MS);
    expect(switchTo).toHaveBeenCalledWith("n");
    controller.spaceShown("n");
    expect(controller.offset).toBe(0);
    expect(controller.swiping).toBe(false);
    expect(controller.takeInstantSwitch()).toBe(true);
    expect(controller.takeInstantSwitch()).toBe(false);
  });

  it("snaps back when the switch never arrives", () => {
    const { controller } = setup();
    controller.apply({ kind: "commit", direction: -1 });
    vi.advanceTimersByTime(SETTLE_MS + 600);
    expect(controller.offset).toBe(0);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(controller.settling).toBe(false);
    expect(controller.swiping).toBe(false);
  });

  it("snaps back on a cancel, or a commit toward no neighbour", () => {
    const { controller, switchTo } = setup({ neighbours: () => ({}) });
    controller.apply({ kind: "track", offset: 40 });
    controller.apply({ kind: "commit", direction: 1 });
    vi.runAllTimers();
    expect(switchTo).not.toHaveBeenCalled();
    expect(controller.offset).toBe(0);
    expect(controller.swiping).toBe(false);
  });

  it("switches in place with reduced motion", () => {
    const { controller, switchTo } = setup({ reduceMotion: () => true });
    controller.apply({ kind: "track", offset: -80 });
    expect(controller.swiping).toBe(false);
    expect(controller.offset).toBe(0);
    controller.apply({ kind: "commit", direction: 1 });
    expect(switchTo).toHaveBeenCalledWith("n");
    expect(controller.takeInstantSwitch()).toBe(true);
  });

  it("ignores other spaces being shown", () => {
    const { controller } = setup();
    controller.apply({ kind: "track", offset: -40 });
    controller.spaceShown("x");
    expect(controller.offset).toBe(-40);
    expect(controller.takeInstantSwitch()).toBe(false);
  });
});
