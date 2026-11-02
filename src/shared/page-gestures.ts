import { SpaceSwipe, type SwipeBounds, type WheelSample } from "./space-swipe";

/**
 * Touchpad gestures on web pages (ADR-033). Pure: main feeds them the page's input events.
 *
 * - `PageSwipe`: two-finger horizontal swipe = back (fingers to the right) / forward. It reuses the
 *   space swipe's state machine (axis lock, 1:1 follow, threshold or flick on release, momentum tail
 *   swallowed) over a fixed travel distance. Whether the page itself scrolls that way is decided
 *   in the page (src/main/page-swipe-script.ts): only bursts it cannot scroll reach this machine.
 *   A burst that starts vertical, or towards a missing history entry, stays ignored until it ends.
 * - `PinchZoomSteps`: Ctrl+wheel and touchpad pinch arrive as a stream of zoom requests; one zoom
 *   step at most every `intervalMs`, so a pinch zooms smoothly instead of jumping to the ends.
 */

export type PageSwipeOutput =
  | { kind: "ignore" }
  /** The indicator follows the fingers: `direction` -1 back, 1 forward; `progress` 0…1 of the threshold. */
  | { kind: "track"; direction: 1 | -1; offset: number; progress: number; ready: boolean }
  | { kind: "commit"; direction: 1 | -1 }
  | { kind: "cancel" };

export interface PageSwipeOptions {
  /** Finger travel (px) that commits on release. */
  commitDistance?: number;
  endGapMs?: number;
}

/** Back (-1) / forward (1) availability. */
export interface HistoryBounds {
  back: boolean;
  forward: boolean;
}

type Gate = { name: "idle" } | { name: "open"; last: number } | { name: "blocked"; last: number };

const COMMIT_RATIO = 0.25;

export class PageSwipe {
  private readonly swipe: SpaceSwipe;
  private readonly commitDistance: number;
  private gate: Gate = { name: "idle" };

  constructor(options: PageSwipeOptions = {}) {
    this.commitDistance = options.commitDistance ?? 120;
    this.swipe = new SpaceSwipe({ width: this.commitDistance / COMMIT_RATIO, commitRatio: COMMIT_RATIO, endGapMs: options.endGapMs ?? 140 });
  }

  get endGapMs(): number {
    return this.swipe.endGapMs;
  }

  /** A swipe is following the fingers (its indicator is shown). */
  get active(): boolean {
    return this.swipe.active;
  }

  wheel(sample: WheelSample, history: HistoryBounds): PageSwipeOutput {
    const gate = this.gate;
    // Mouse wheels (lines/pages), Shift+wheel and Ctrl+wheel (zoom) are never swipes.
    const plain = sample.deltaMode === 0 && !sample.shiftKey && !sample.ctrlKey;
    if (gate.name === "idle" || sample.time - gate.last >= this.swipe.endGapMs) {
      if (gate.name === "open" && this.swipe.active) return this.map(this.swipe.end(sample.time, bounds(history)), history);
      if (!plain || Math.abs(sample.deltaX) <= Math.abs(sample.deltaY) * 1.2 || sample.deltaX === 0) {
        this.gate = { name: "blocked", last: sample.time };
        return { kind: "ignore" };
      }
      // Nowhere to go that way: no swipe.
      const direction = sample.deltaX < 0 ? -1 : 1;
      this.gate = { name: (direction < 0 ? history.back : history.forward) ? "open" : "blocked", last: sample.time };
      if (this.gate.name === "blocked") return { kind: "ignore" };
    } else {
      gate.last = sample.time;
      if (gate.name !== "open") return { kind: "ignore" };
    }
    return this.map(this.swipe.wheel(sample, bounds(history)), history);
  }

  /** The caller's timer, `endGapMs` after the last event. */
  end(time: number, history: HistoryBounds): PageSwipeOutput {
    const gate = this.gate;
    if (gate.name === "idle" || time - gate.last < this.swipe.endGapMs) return { kind: "ignore" };
    this.gate = { name: "idle" };
    return gate.name === "open" ? this.map(this.swipe.end(time, bounds(history)), history) : { kind: "ignore" };
  }

  private map(output: ReturnType<SpaceSwipe["wheel"]>, history: HistoryBounds): PageSwipeOutput {
    switch (output.kind) {
      case "track": {
        // Fingers to the right (offset > 0) go back, like the space swipe's "previous".
        const direction = output.offset > 0 ? -1 : 1;
        const progress = Math.min(1, Math.abs(output.offset) / this.commitDistance);
        const allowed = direction < 0 ? history.back : history.forward;
        return { kind: "track", direction, offset: output.offset, progress, ready: allowed && progress >= 1 };
      }
      case "commit":
        return { kind: "commit", direction: output.direction };
      case "cancel":
        return { kind: "cancel" };
      default:
        return { kind: "ignore" };
    }
  }
}

const bounds = (history: HistoryBounds): SwipeBounds => ({ previous: history.back, next: history.forward });

/** Ctrl+wheel / pinch zoom requests → at most one zoom step per `intervalMs` (a change of direction goes through). */
export class PinchZoomSteps {
  private last = -Infinity;
  private direction: 1 | -1 | 0 = 0;

  constructor(private readonly intervalMs = 110) {}

  /** The step to apply now (0: none). */
  request(direction: 1 | -1, time: number): 1 | -1 | 0 {
    if (direction === this.direction && time - this.last < this.intervalMs) return 0;
    this.direction = direction;
    this.last = time;
    return direction;
  }
}
