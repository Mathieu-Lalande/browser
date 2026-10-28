/**
 * Two-finger horizontal swipe on the sidebar to change space (ADR-022). Pure: the chrome UI feeds
 * it the sidebar's `wheel` events (macOS and Windows precision touchpads report two-finger
 * scrolling as pixel wheel deltas, horizontal ones in `deltaX`) and applies what it returns.
 *
 * - Axis lock: the first few pixels decide; a mostly vertical gesture (and so any plain mouse
 *   wheel, which only has `deltaY`) is left alone until it ends.
 * - Mouse wheels in line/page mode, Shift+wheel (horizontal scrolling with a mouse) and Ctrl+wheel
 *   (pinch zoom) never start a swipe.
 * - The content follows the fingers, rubber-banded when there is no space on that side, and the
 *   switch happens past `commitRatio` of the width or on a fast enough fling.
 * - Cooldown: once a swipe switched space, every event of the same gesture (including macOS
 *   momentum events after the fingers left) is swallowed until a short pause: one swipe, one space.
 */

export interface SpaceSwipeOptions {
  /** Width of the swiped area, px. */
  width: number;
  /** Fraction of the width to travel to commit. */
  commitRatio?: number;
  /** Velocity (px/ms) of a fling that commits early… */
  flingVelocity?: number;
  /** …once it travelled this fraction of the width. */
  flingMinRatio?: number;
  /** Distance (px) after which the axis is decided. */
  lockDistance?: number;
  /** A pause this long (ms) ends a gesture. */
  endGapMs?: number;
  /** After a switch, events are swallowed until a pause this long (ms). */
  cooldownGapMs?: number;
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
  /** Switch to the next (1) or previous (-1) space; the content goes back to 0. */
  | { kind: "commit"; direction: 1 | -1 }
  /** The gesture that just switched space goes on: prevent the default, do nothing. */
  | { kind: "swallow" }
  /** The gesture ended short of the threshold: snap back to 0. */
  | { kind: "cancel" };

type Phase =
  | { name: "idle" }
  | { name: "deciding"; x: number; y: number; last: number }
  | { name: "vertical"; last: number }
  | { name: "tracking"; x: number; last: number; samples: { time: number; x: number }[] }
  | { name: "cooldown"; last: number };

/** iOS-like resistance past the ends. */
export function rubberBand(offset: number, dimension: number, coefficient = 0.55): number {
  const sign = offset < 0 ? -1 : 1;
  return sign * (1 - 1 / ((Math.abs(offset) * coefficient) / dimension + 1)) * dimension;
}

const VELOCITY_WINDOW_MS = 80;
/** Synthetic or coalesced events can share a timestamp: never divide by less than a frame. */
const MIN_DT_MS = 16;

export class SpaceSwipe {
  private phase: Phase = { name: "idle" };
  private readonly options: Required<SpaceSwipeOptions>;

  constructor(options: SpaceSwipeOptions) {
    this.options = {
      commitRatio: 0.3,
      flingVelocity: 1.2,
      flingMinRatio: 0.1,
      lockDistance: 8,
      endGapMs: 140,
      cooldownGapMs: 260,
      ...options,
    };
  }

  setWidth(width: number): void {
    this.options.width = Math.max(1, width);
  }

  get active(): boolean {
    return this.phase.name === "tracking";
  }

  wheel(sample: WheelSample, bounds: SwipeBounds): SwipeOutput {
    const { endGapMs, cooldownGapMs, lockDistance } = this.options;
    const phase = this.phase;
    // A pause ends whatever was going on: this event starts a new gesture.
    if (phase.name !== "idle" && sample.time - phase.last >= (phase.name === "cooldown" ? cooldownGapMs : endGapMs)) {
      this.phase = { name: "idle" };
      return this.wheel(sample, bounds);
    }
    switch (phase.name) {
      case "cooldown":
        phase.last = sample.time;
        return { kind: "swallow" };
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
        if (Math.hypot(phase.x, phase.y) < lockDistance) return { kind: "ignore" };
        // Horizontal only when it clearly dominates: diagonal scrolling stays a scroll.
        if (Math.abs(phase.x) <= Math.abs(phase.y) * 1.5) {
          this.phase = { name: "vertical", last: sample.time };
          return { kind: "ignore" };
        }
        this.phase = { name: "tracking", x: phase.x, last: sample.time, samples: [{ time: sample.time, x: phase.x }] };
        return this.evaluate(bounds);
      }
      case "tracking": {
        phase.x += sample.deltaX;
        phase.last = sample.time;
        phase.samples.push({ time: sample.time, x: phase.x });
        while (phase.samples.length > 2 && sample.time - phase.samples[0].time > VELOCITY_WINDOW_MS) phase.samples.shift();
        return this.evaluate(bounds);
      }
    }
  }

  /** No event for `endGapMs` (the caller's timer): the fingers left without committing. */
  end(time: number): SwipeOutput {
    const phase = this.phase;
    if (phase.name === "tracking" && time - phase.last >= this.options.endGapMs) {
      this.phase = { name: "idle" };
      return { kind: "cancel" };
    }
    if (phase.name !== "idle" && phase.name !== "tracking" && time - phase.last >= (phase.name === "cooldown" ? this.options.cooldownGapMs : this.options.endGapMs)) {
      this.phase = { name: "idle" };
    }
    return { kind: "ignore" };
  }

  private evaluate(bounds: SwipeBounds): SwipeOutput {
    const phase = this.phase;
    if (phase.name !== "tracking") return { kind: "ignore" };
    const { width, commitRatio, flingVelocity, flingMinRatio } = this.options;
    // Natural scrolling: fingers moving left scroll right (deltaX > 0) and reveal the next space.
    const offset = -phase.x;
    const direction: 1 | -1 = offset < 0 ? 1 : -1;
    const allowed = direction === 1 ? bounds.next : bounds.previous;
    // Nothing that way: resisted, and never more than 40% of the width.
    if (!allowed) return { kind: "track", offset: rubberBand(offset, width * 0.4) };
    const first = phase.samples[0];
    const last = phase.samples[phase.samples.length - 1];
    const velocity = (last.x - first.x) / Math.max(MIN_DT_MS, last.time - first.time);
    const flung = Math.abs(velocity) >= flingVelocity && Math.sign(velocity) === Math.sign(phase.x) && Math.abs(offset) >= width * flingMinRatio;
    if (Math.abs(offset) >= width * commitRatio || flung) {
      this.phase = { name: "cooldown", last: phase.last };
      return { kind: "commit", direction };
    }
    return { kind: "track", offset };
  }
}
