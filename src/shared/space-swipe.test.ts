import { describe, expect, it } from "vitest";
import { SpaceSwipe, rubberBand, type SwipeBounds, type SwipeOutput } from "./space-swipe";

const both: SwipeBounds = { previous: true, next: true };
const WIDTH = 300;

/** Feeds wheel events `step` ms apart; returns the outputs. */
function feed(swipe: SpaceSwipe, deltas: [number, number][], options: { start?: number; step?: number; bounds?: SwipeBounds; deltaMode?: number; shiftKey?: boolean } = {}): SwipeOutput[] {
  const { start = 0, step = 16, bounds = both, deltaMode = 0, shiftKey = false } = options;
  return deltas.map(([deltaX, deltaY], i) => swipe.wheel({ deltaX, deltaY, deltaMode, shiftKey, time: start + i * step }, bounds));
}

const repeat = (n: number, delta: [number, number]) => Array.from({ length: n }, () => delta);
const commits = (outputs: SwipeOutput[]) => outputs.filter((o) => o.kind === "commit");

describe("space swipe", () => {
  it("follows the fingers, then switches past 30% of the width", () => {
    // Slow drag (no fling): 10 px every 40 ms.
    const swipe = new SpaceSwipe({ width: WIDTH });
    const outputs = feed(swipe, repeat(12, [10, 0]), { step: 40 });
    const tracked = outputs.filter((o) => o.kind === "track") as { offset: number }[];
    expect(tracked[0].offset).toBeLessThan(0);
    // Fingers left (deltaX > 0): the next space.
    expect(commits(outputs)).toEqual([{ kind: "commit", direction: 1 }]);
    expect(outputs.findIndex((o) => o.kind === "commit")).toBe(8);
  });

  it("goes to the previous space the other way", () => {
    const outputs = feed(new SpaceSwipe({ width: WIDTH }), repeat(12, [-10, 0]), { step: 40 });
    expect(commits(outputs)).toEqual([{ kind: "commit", direction: -1 }]);
  });

  it("commits early on a fast fling", () => {
    const outputs = feed(new SpaceSwipe({ width: WIDTH }), repeat(4, [25, 0]), { step: 10 });
    expect(commits(outputs)).toHaveLength(1);
  });

  it("changes one space per swipe: the rest of the gesture (momentum) is swallowed", () => {
    const swipe = new SpaceSwipe({ width: WIDTH });
    const outputs = feed(swipe, repeat(60, [30, 0]), { step: 16 });
    expect(commits(outputs)).toHaveLength(1);
    expect(outputs.at(-1)).toEqual({ kind: "swallow" });
    // After a pause, a new swipe switches again.
    expect(commits(feed(swipe, repeat(20, [30, 0]), { start: 60 * 16 + 400 }))).toHaveLength(1);
  });

  it("snaps back when the fingers leave short of the threshold", () => {
    const swipe = new SpaceSwipe({ width: WIDTH });
    feed(swipe, repeat(4, [10, 0]), { step: 40 });
    expect(swipe.end(1000)).toEqual({ kind: "cancel" });
    expect(swipe.active).toBe(false);
  });

  it("rubber-bands at the first and last space, never switching", () => {
    const outputs = feed(new SpaceSwipe({ width: WIDTH }), repeat(40, [30, 0]), { bounds: { previous: true, next: false } });
    expect(commits(outputs)).toHaveLength(0);
    const last = outputs.at(-1) as { kind: "track"; offset: number };
    expect(last.kind).toBe("track");
    expect(Math.abs(last.offset)).toBeLessThan(WIDTH * 0.4);
    expect(rubberBand(-1200, WIDTH)).toBeCloseTo(-WIDTH * 0.6875, 3);
  });

  it("ignores vertical scrolling, plain mouse wheels and Shift/Ctrl+wheel", () => {
    // Mostly vertical two-finger scroll, then horizontal drift in the same gesture.
    const swipe = new SpaceSwipe({ width: WIDTH });
    const vertical = feed(swipe, [...repeat(5, [2, 20]), ...repeat(20, [30, 0])]);
    expect(vertical.every((o) => o.kind === "ignore")).toBe(true);
    // A mouse wheel: deltaY only, in lines.
    expect(feed(new SpaceSwipe({ width: WIDTH }), repeat(20, [0, 3]), { deltaMode: 1 }).every((o) => o.kind === "ignore")).toBe(true);
    expect(feed(new SpaceSwipe({ width: WIDTH }), repeat(20, [0, 100])).every((o) => o.kind === "ignore")).toBe(true);
    expect(feed(new SpaceSwipe({ width: WIDTH }), repeat(20, [100, 0]), { shiftKey: true }).every((o) => o.kind === "ignore")).toBe(true);
  });

  it("does not divide by zero when events share a timestamp (synthetic events)", () => {
    const outputs = feed(new SpaceSwipe({ width: WIDTH }), repeat(20, [30, 0]), { step: 0 });
    expect(commits(outputs)).toHaveLength(1);
  });
});
