import { describe, expect, it } from "vitest";
import { PageSwipe, PinchZoomSteps, type PageSwipeOutput } from "./page-gestures";

const wheel = (deltaX: number, time: number, extra: { deltaY?: number; ctrlKey?: boolean; deltaMode?: number } = {}) => ({
  deltaX,
  deltaY: extra.deltaY ?? 0,
  deltaMode: extra.deltaMode ?? 0,
  ctrlKey: extra.ctrlKey,
  time,
});

const both = { back: true, forward: true };

/** A burst of `count` events of `deltaX` every 16 ms from `start`. */
function burst(swipe: PageSwipe, deltaX: number, count: number, start = 0, history = both): PageSwipeOutput[] {
  return Array.from({ length: count }, (_, i) => swipe.wheel(wheel(deltaX, start + i * 16), history));
}

describe("page swipe", () => {
  it("follows the fingers and goes back past the threshold", () => {
    const swipe = new PageSwipe();
    const outputs = burst(swipe, -12, 16);
    expect(outputs.some((output) => output.kind === "track" && output.direction === -1 && !output.ready)).toBe(true);
    const last = outputs.at(-1)!;
    expect(last).toMatchObject({ kind: "track", direction: -1, ready: true });
    expect(swipe.end(16 * 16 + 200, both)).toEqual({ kind: "commit", direction: -1 });
  });

  it("goes forward the other way, and cancels short of the threshold", () => {
    const forward = new PageSwipe();
    burst(forward, 12, 16);
    expect(forward.end(1000, both)).toEqual({ kind: "commit", direction: 1 });

    const short = new PageSwipe();
    // Slow, short travel: no flick.
    for (let i = 0; i < 6; i++) short.wheel(wheel(-3, i * 40), both);
    expect(short.end(1000, both)).toEqual({ kind: "cancel" });
  });

  it("keeps a burst that started without history that way, then starts afresh", () => {
    const swipe = new PageSwipe();
    const outputs = burst(swipe, -12, 16, 0, { back: false, forward: true });
    expect(outputs.every((output) => output.kind === "ignore")).toBe(true);
    expect(swipe.end(1000, both)).toEqual({ kind: "ignore" });
    burst(swipe, -12, 16, 2000);
    expect(swipe.end(3000, both)).toEqual({ kind: "commit", direction: -1 });
  });

  it("ignores vertical scrolling, Ctrl+wheel, mouse wheels and directions without history", () => {
    const swipe = new PageSwipe();
    expect(swipe.wheel(wheel(1, 0, { deltaY: 20 }), both)).toEqual({ kind: "ignore" });
    expect(swipe.wheel(wheel(-20, 30), both)).toEqual({ kind: "ignore" });
    expect(new PageSwipe().wheel(wheel(-20, 0, { ctrlKey: true }), both)).toEqual({ kind: "ignore" });
    expect(new PageSwipe().wheel(wheel(-20, 0, { deltaMode: 1 }), both)).toEqual({ kind: "ignore" });
    expect(new PageSwipe().wheel(wheel(-20, 0), { back: false, forward: true })).toEqual({ kind: "ignore" });
  });
});

describe("pinch zoom steps", () => {
  it("zooms one step per interval, and turns around at once", () => {
    const steps = new PinchZoomSteps(100);
    expect(steps.request(1, 0)).toBe(1);
    expect(steps.request(1, 30)).toBe(0);
    expect(steps.request(1, 99)).toBe(0);
    expect(steps.request(1, 120)).toBe(1);
    expect(steps.request(-1, 130)).toBe(-1);
  });
});
