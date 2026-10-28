import { describe, expect, it } from "vitest";
import { SpaceSwipe, rubberBand, type SwipeBounds, type SwipeOutput } from "./space-swipe";

const both: SwipeBounds = { previous: true, next: true };
const WIDTH = 300;

type Event = [deltaX: number, deltaY: number, gapMs?: number];

/**
 * Replays wheel events (`step` ms apart unless an event gives its own gap), then lets the
 * caller's end timer fire after the last one. Returns every output, the timer's included.
 */
function replay(
  swipe: SpaceSwipe,
  events: Event[],
  options: { start?: number; step?: number; bounds?: SwipeBounds; deltaMode?: number; shiftKey?: boolean; end?: boolean } = {},
): SwipeOutput[] {
  const { start = 0, step = 16, bounds = both, deltaMode = 0, shiftKey = false, end = true } = options;
  let time = start;
  const outputs = events.map(([deltaX, deltaY, gap], index) => {
    if (index > 0) time += gap ?? step;
    return swipe.wheel({ deltaX, deltaY, deltaMode, shiftKey, time }, bounds);
  });
  if (end) outputs.push(swipe.end(time + swipe.endGapMs, bounds));
  return outputs;
}

const repeat = (n: number, delta: Event) => Array.from({ length: n }, () => delta);
const commits = (outputs: SwipeOutput[]) => outputs.filter((o) => o.kind === "commit");
const tracked = (outputs: SwipeOutput[]) => outputs.filter((o) => o.kind === "track") as { offset: number }[];

/** macOS: fingers accelerate, then the momentum tail decays for a long while (16 ms apart). */
function macSwipe(sign = 1): Event[] {
  const fingers = [4, 9, 16, 24, 30, 32];
  const tail: number[] = [];
  for (let delta = 30; delta >= 0.5; delta *= 0.9) tail.push(Math.round(delta * 10) / 10);
  return [...fingers, ...tail].map((delta) => [sign * delta, 0]);
}

describe("space swipe", () => {
  it("follows the fingers 1:1, then a slow drag past 25% switches on release", () => {
    const swipe = new SpaceSwipe({ width: WIDTH });
    // 10 px every 40 ms (0.25 px/ms: no flick), 90 px = 30%.
    const outputs = replay(swipe, repeat(9, [10, 0]), { step: 40 });
    const offsets = tracked(outputs).map((o) => o.offset);
    expect(offsets[0]).toBe(-10);
    expect(offsets.at(-1)).toBe(-90);
    // Nothing switches while the fingers are down: only on release (the end timer).
    expect(outputs.slice(0, -1).some((o) => o.kind === "commit")).toBe(false);
    expect(outputs.at(-1)).toEqual({ kind: "commit", direction: 1 });
  });

  it("goes to the previous space the other way", () => {
    expect(commits(replay(new SpaceSwipe({ width: WIDTH }), repeat(9, [-10, 0]), { step: 40 }))).toEqual([{ kind: "commit", direction: -1 }]);
  });

  it("a slow drag released short of 25% slides back", () => {
    const swipe = new SpaceSwipe({ width: WIDTH });
    const outputs = replay(swipe, repeat(5, [10, 0]), { step: 40 });
    expect(outputs.at(-1)).toEqual({ kind: "cancel" });
    expect(swipe.active).toBe(false);
  });

  it("a short fast flick switches", () => {
    // 4 events of 12 px, 8 ms apart: 48 px (16%) at 1.5 px/ms.
    const outputs = replay(new SpaceSwipe({ width: WIDTH }), repeat(4, [12, 0]), { step: 8 });
    expect(commits(outputs)).toEqual([{ kind: "commit", direction: 1 }]);
  });

  it("a vertical scroll with some sideways noise never switches", () => {
    const swipe = new SpaceSwipe({ width: WIDTH });
    const noisy: Event[] = Array.from({ length: 40 }, (_, i) => [i % 3 === 0 ? 6 : -3, 18]);
    // Even when it drifts sideways later in the same gesture.
    const outputs = replay(swipe, [...noisy, ...repeat(20, [30, 2])]);
    expect(outputs.every((o) => o.kind === "ignore")).toBe(true);
  });

  it("a macOS momentum tail switches once, and is swallowed until it goes idle", () => {
    const swipe = new SpaceSwipe({ width: WIDTH });
    const events = macSwipe();
    const outputs = replay(swipe, events);
    expect(commits(outputs)).toHaveLength(1);
    // Decided as soon as the deltas decay (the fingers left), not at the end of the long tail.
    expect(outputs.findIndex((o) => o.kind === "commit")).toBeLessThan(events.length / 2);
    expect(outputs.slice(outputs.findIndex((o) => o.kind === "commit") + 1, -1).every((o) => o.kind === "swallow")).toBe(true);
    // After the pause, the next swipe switches again.
    expect(commits(replay(swipe, macSwipe(), { start: 10_000 }))).toHaveLength(1);
  });

  it("a second swipe started inside the momentum tail is not dropped", () => {
    const swipe = new SpaceSwipe({ width: WIDTH });
    const first = macSwipe().slice(0, 16);
    // The fingers land again: the tail stops and the deltas grow back.
    const second = macSwipe().slice(0, 12);
    expect(commits(replay(swipe, [...first, ...second]))).toHaveLength(2);
    // The other way inside the tail: a new gesture too, back to the previous space.
    const other = new SpaceSwipe({ width: WIDTH });
    expect(commits(replay(other, [...macSwipe().slice(0, 16), ...macSwipe(-1).slice(0, 12)])).map((o) => (o as { direction: number }).direction)).toEqual([1, -1]);
  });

  it("a Windows precision touchpad burst (steady deltas, then nothing) switches once", () => {
    const swipe = new SpaceSwipe({ width: WIDTH });
    // 8 ms apart, steady with a little jitter, far past one width: clamped, then one switch.
    const burst: Event[] = Array.from({ length: 60 }, (_, i) => [20 + (i % 2 ? 3 : -3), i % 4 === 0 ? 1 : 0]);
    const outputs = replay(swipe, burst, { step: 8 });
    expect(Math.min(...tracked(outputs).map((o) => o.offset))).toBe(-WIDTH);
    expect(commits(outputs)).toHaveLength(1);
    // A second burst after a short (human) pause switches again.
    expect(commits(replay(swipe, burst, { step: 8, start: 60 * 8 + 300 }))).toHaveLength(1);
  });

  it("rubber-bands at the first and last space, never switching", () => {
    const outputs = replay(new SpaceSwipe({ width: WIDTH }), repeat(40, [30, 0]), { bounds: { previous: true, next: false } });
    expect(commits(outputs)).toHaveLength(0);
    expect(outputs.at(-1)).toEqual({ kind: "cancel" });
    const last = tracked(outputs).at(-1)!;
    expect(Math.abs(last.offset)).toBeLessThan(WIDTH * 0.4);
    expect(rubberBand(-1200, WIDTH)).toBeCloseTo(-WIDTH * 0.6875, 3);
  });

  it("ignores plain mouse wheels and Shift/Ctrl+wheel", () => {
    expect(replay(new SpaceSwipe({ width: WIDTH }), repeat(20, [0, 3]), { deltaMode: 1 }).every((o) => o.kind === "ignore")).toBe(true);
    expect(replay(new SpaceSwipe({ width: WIDTH }), repeat(20, [0, 100])).every((o) => o.kind === "ignore")).toBe(true);
    expect(replay(new SpaceSwipe({ width: WIDTH }), repeat(20, [100, 0]), { shiftKey: true }).every((o) => o.kind === "ignore")).toBe(true);
  });

  it("does not divide by zero when events share a timestamp (synthetic events)", () => {
    expect(commits(replay(new SpaceSwipe({ width: WIDTH }), repeat(20, [30, 0]), { step: 0 }))).toHaveLength(1);
  });
});
