/**
 * Two-finger horizontal swipe on the sidebar to change space (ADR-022). Pure: the chrome UI feeds
 * it the sidebar's `wheel` events (macOS and Windows precision touchpads report two-finger
 * scrolling as pixel wheel deltas, horizontal ones in `deltaX`) and applies what it returns.
 *
 * - Axis lock on the first few pixels: a gesture where `deltaX` does not dominate (and so any plain
 *   mouse wheel, which only has `deltaY`) stays a scroll until it ends. Mouse wheels in line/page
 *   mode, Shift+wheel (horizontal scrolling with a mouse) and Ctrl+wheel (pinch zoom) never start a swipe.
 * - While the fingers move, the content follows them 1:1 (`track`), rubber-banded where there is
 *   no space, never more than one width.
 * - The decision comes on release: no event for `endGapMs` (the caller's timer calls `end`), or the
 *   deltas decaying (the fingers left: macOS momentum, Windows inertia). It commits past
 *   `commitRatio` of the width, or on a fast enough flick (velocity over the last 80 ms).
 * - One gesture, one space: after a commit, the rest of the burst (momentum tail) is swallowed until
 *   it goes idle, unless a new swipe clearly starts in it (deltas growing again, or reversing).
 */

export interface SpaceSwipeOptions {
  /** Width of the swiped area, px. */
  width: number;
  /** Fraction of the width to travel to commit on release. */
  commitRatio?: number;
  /** Release velocity (px/ms) of a flick that commits… */
  flingVelocity?: number;
  /** …once it travelled this many px. */
  flingMinDistance?: number;
  /** Distance (px) after which the axis is decided. */
  lockDistance?: number;
  /** Horizontal when |x| > axisRatio × |y| at the lock. */
  axisRatio?: number;
  /** A pause this long (ms) ends a gesture. */
  endGapMs?: number;
}

export interface WheelSample {
  deltaX: number;
  deltaY: number;
  /** `WheelEvent.deltaMode`: 0 pixels (touchpads), 1 lines, 2 pages. */
  deltaMode: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  /** ms (`event.timeStamp`). */
  time: number;
}

/** Whether there is a space before (-1) / after (1) the current one. */
export interface SwipeBounds {
  previous: boolean;
  next: boolean;
}

export type SwipeOutput =
  /** Not a swipe: let the event do what it normally does (scroll the tab list…). */
  | { kind: "ignore" }
  /** A swipe in progress: prevent the default, move the content by `offset` px. */
  | { kind: "track"; offset: number }
  /** Released past the threshold: slide to the next (1) or previous (-1) space, then switch. */
  | { kind: "commit"; direction: 1 | -1 }
  /** The rest of a committed gesture (momentum): prevent the default, do nothing. */
  | { kind: "swallow" }
  /** Released short of the threshold: slide back to 0. */
  | { kind: "cancel" };

type Sample = { time: number; x: number };
type Phase =
  | { name: "idle" }
  | { name: "deciding"; x: number; y: number; last: number }
  | { name: "vertical"; last: number }
  | { name: "tracking"; x: number; last: number; samples: Sample[]; previous: number; peak: number; decays: number }
  | { name: "suppress"; last: number; sign: number; previous: number; rising: number };

/** iOS-like resistance past the ends. */
export function rubberBand(offset: number, dimension: number, coefficient = 0.55): number {
  const sign = offset < 0 ? -1 : 1;
  return sign * (1 - 1 / ((Math.abs(offset) * coefficient) / dimension + 1)) * dimension;
}

const VELOCITY_WINDOW_MS = 80;
/** Synthetic or coalesced events can share a timestamp: never divide by less than a frame. */
const MIN_DT_MS = 16;
/** Consecutive shrinking deltas (below 70% of the peak) that mean the fingers left. */
const DECAY_EVENTS = 3;

export class SpaceSwipe {
  private phase: Phase = { name: "idle" };
  private readonly options: Required<SpaceSwipeOptions>;

  constructor(options: SpaceSwipeOptions) {
    this.options = {
      commitRatio: 0.25,
      flingVelocity: 0.5,
      flingMinDistance: 16,
      lockDistance: 4,
      axisRatio: 1.2,
      endGapMs: 140,
      ...options,
    };
  }

  setWidth(width: number): void {
    this.options.width = Math.max(1, width);
  }

  get endGapMs(): number {
    return this.options.endGapMs;
  }

  /** The content is following the fingers. */
  get active(): boolean {
    return this.phase.name === "tracking";
  }

  wheel(sample: WheelSample, bounds: SwipeBounds): SwipeOutput {
    const { endGapMs, lockDistance, axisRatio } = this.options;
    const phase = this.phase;
    // A pause ended whatever was going on (the caller's timer may have been late).
    if (phase.name !== "idle" && sample.time - phase.last >= endGapMs) {
      if (phase.name === "tracking") return this.release(bounds);
      this.phase = { name: "idle" };
      return this.wheel(sample, bounds);
    }
    switch (phase.name) {
      case "suppress": {
        phase.last = sample.time;
        const magnitude = Math.abs(sample.deltaX);
        // A new swipe inside the tail: the fingers went the other way, or the deltas grow again.
        const reversed = magnitude >= 2 && Math.sign(sample.deltaX) === -phase.sign;
        phase.rising = magnitude > phase.previous * 1.5 + 1 ? phase.rising + 1 : 0;
        phase.previous = magnitude;
        if (reversed || phase.rising >= 2) {
          this.phase = { name: "idle" };
          return this.wheel(sample, bounds);
        }
        return { kind: "swallow" };
      }
      case "vertical":
        phase.last = sample.time;
        return { kind: "ignore" };
      case "idle": {
        if (sample.deltaMode !== 0 || sample.shiftKey || sample.ctrlKey) return { kind: "ignore" };
        this.phase = { name: "deciding", x: 0, y: 0, last: sample.time };
        return this.wheel(sample, bounds);
      }
      case "deciding": {
        phase.x += sample.deltaX;
        phase.y += sample.deltaY;
        phase.last = sample.time;
        if (Math.abs(phase.x) + Math.abs(phase.y) < lockDistance) return { kind: "ignore" };
        if (Math.abs(phase.x) <= Math.abs(phase.y) * axisRatio) {
          this.phase = { name: "vertical", last: sample.time };
          return { kind: "ignore" };
        }
        const magnitude = Math.abs(sample.deltaX);
        this.phase = { name: "tracking", x: phase.x, last: sample.time, samples: [{ time: sample.time, x: phase.x }], previous: magnitude, peak: magnitude, decays: 0 };
        return this.track(bounds);
      }
      case "tracking": {
        phase.x += sample.deltaX;
        phase.last = sample.time;
        phase.samples.push({ time: sample.time, x: phase.x });
        while (phase.samples.length > 2 && sample.time - phase.samples[0].time > VELOCITY_WINDOW_MS) phase.samples.shift();
        const magnitude = Math.abs(sample.deltaX);
        if (magnitude < phase.previous && magnitude < phase.peak * 0.7) phase.decays++;
        else if (magnitude > phase.previous) phase.decays = 0;
        phase.previous = magnitude;
        phase.peak = Math.max(phase.peak, magnitude);
        // The fingers left and the tail keeps going: decide now if it is a switch, else let it glide.
        if (phase.decays >= DECAY_EVENTS && this.decide(bounds)) return this.release(bounds);
        return this.track(bounds);
      }
    }
  }

  /** The caller's timer, `endGapMs` after the last event: a gesture still tracking is released. */
  end(time: number, bounds: SwipeBounds): SwipeOutput {
    const phase = this.phase;
    if (phase.name === "idle" || time - phase.last < this.options.endGapMs) return { kind: "ignore" };
    if (phase.name === "tracking") return this.release(bounds);
    this.phase = { name: "idle" };
    return { kind: "ignore" };
  }

  /** Where the content is: follows the fingers, resisted where there is no space. */
  private track(bounds: SwipeBounds): SwipeOutput {
    if (this.phase.name !== "tracking") return { kind: "ignore" };
    const { width } = this.options;
    // Natural scrolling: fingers moving left scroll right (deltaX > 0) and reveal the next space.
    const offset = -this.phase.x;
    const allowed = offset < 0 ? bounds.next : bounds.previous;
    if (!allowed) return { kind: "track", offset: rubberBand(offset, width * 0.4) };
    return { kind: "track", offset: Math.max(-width, Math.min(width, offset)) };
  }

  /** The switch the gesture asks for if released now (null: back to 0). */
  private decide(bounds: SwipeBounds): 1 | -1 | null {
    const phase = this.phase;
    if (phase.name !== "tracking") return null;
    const { width, commitRatio, flingVelocity, flingMinDistance } = this.options;
    const offset = -phase.x;
    const direction: 1 | -1 = offset < 0 ? 1 : -1;
    if (!(direction === 1 ? bounds.next : bounds.previous)) return null;
    const first = phase.samples[0];
    const last = phase.samples[phase.samples.length - 1];
    const velocity = (last.x - first.x) / Math.max(MIN_DT_MS, last.time - first.time);
    const flicked = Math.abs(velocity) >= flingVelocity && Math.sign(velocity) === Math.sign(phase.x) && Math.abs(offset) >= flingMinDistance;
    return Math.abs(offset) >= width * commitRatio || flicked ? direction : null;
  }

  private release(bounds: SwipeBounds): SwipeOutput {
    const phase = this.phase;
    if (phase.name !== "tracking") return { kind: "ignore" };
    const direction = this.decide(bounds);
    if (direction === null) {
      this.phase = { name: "idle" };
      return { kind: "cancel" };
    }
    // The rest of this burst is swallowed (an idle gap resets it).
    this.phase = { name: "suppress", last: phase.last, sign: Math.sign(phase.x), previous: phase.previous, rising: 0 };
    return { kind: "commit", direction };
  }
}
