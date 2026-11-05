import { SpaceSwipe, type SwipeOutput } from "@shared/space-swipe";
import type { SpaceId } from "@shared/types";

/**
 * Two-finger (or touch) swipe between spaces in the sidebar (ADR-022, ADR-031; gesture logic in
 * @shared/space-swipe).
 *
 * The tab area is a horizontal track: the shown space, with its neighbours (`peeks`, sent by main)
 * laid beside it while a swipe is on. The track follows the fingers; on release it slides to the
 * snapped position (SETTLE_MS), and only then is the space switched, without the switch's own
 * slide: the neighbour already sits where the new content appears, so nothing jumps.
 */

/** Room between the shown space and its neighbours on the track, px. */
export const PEEK_GAP = 16;
/** A switch that main has not confirmed after this long is given up (back to rest), ms. */
const SWITCH_TIMEOUT_MS = 600;

export interface SpaceSwipeHost {
  /** The spaces beside the shown one (none at the ends). */
  neighbours: () => { previous?: { id: SpaceId }; next?: { id: SpaceId } };
  reduceMotion: () => boolean;
  switchTo: (id: SpaceId) => void;
  /** Something else owns the pointer (a row drag): no swipe. */
  blocked: () => boolean;
  /** The finger lifted after a swipe: that lift is not a tap on the row below it. */
  onLift: () => void;
}

export class SpaceSwipeController {
  /** Horizontal offset of the track, px. */
  offset = $state(0);
  /** Kept for the UI contract; space switches are intentionally immediate. */
  settling = $state(false);
  /** The neighbours are drawn (from the first tracked event until the track is back at rest). */
  swiping = $state(false);
  trackWidth = $state(1);

  /** Space the release slid to, switched in main: its state arrives next. */
  #switchingTo: SpaceId | null = null;
  /** The next space switch replaces the content in place (no slide of its own). */
  #instantSwitch = false;
  #settleTimer: ReturnType<typeof setTimeout> | undefined;
  readonly #host: SpaceSwipeHost;

  constructor(host: SpaceSwipeHost) {
    this.#host = host;
  }

  /** Share of the way to a neighbour (+1 next, -1 previous): the space chips' indicator follows. */
  get progress(): number {
    const progress = -this.offset / (this.trackWidth + PEEK_GAP);
    const { previous, next } = this.#host.neighbours();
    if ((progress > 0 && !next) || (progress < 0 && !previous)) return 0;
    return Math.max(-1, Math.min(1, progress));
  }

  /** The space shown changed: when it is the one the release slid to, drop the offset with it. */
  spaceShown(id: SpaceId): void {
    if (this.#switchingTo === null || id !== this.#switchingTo) return;
    this.#switchingTo = null;
    this.#instantSwitch = true;
    this.settling = false;
    this.swiping = false;
    this.offset = 0;
  }

  /** Whether the content now shown must appear in place (consumed: the next switch slides again). */
  takeInstantSwitch(): boolean {
    const instant = this.#instantSwitch;
    this.#instantSwitch = false;
    return instant;
  }

  /** Applies a step of the gesture machine. */
  apply(output: SwipeOutput): void {
    if (output.kind === "track") {
      this.settling = false;
      clearTimeout(this.#settleTimer);
      if (this.#host.reduceMotion()) return;
      this.swiping = true;
      this.offset = output.offset;
    } else if (output.kind === "commit") this.#commit(output.direction);
    else if (output.kind === "cancel") this.#snapBack();
  }

  /** Sliding to a space: the rest of that gesture changes nothing. */
  get #sliding(): boolean {
    return this.settling && this.offset !== 0;
  }

  /**
   * Listens to wheel and touch events on `element` (the sidebar); `area` is the track's viewport,
   * whose width a full swipe covers. Returns the cleanup.
   */
  attach(element: HTMLElement, area: () => HTMLElement | undefined): () => void {
    const swipe = new SpaceSwipe({ width: area()?.clientWidth ?? element.clientWidth });
    let endTimer: ReturnType<typeof setTimeout> | undefined;
    const bounds = () => {
      const { previous, next } = this.#host.neighbours();
      return { previous: !!previous, next: !!next };
    };
    const measure = () => {
      this.trackWidth = area()?.clientWidth || element.clientWidth;
      swipe.setWidth(this.trackWidth);
    };
    const onWheel = (event: WheelEvent) => {
      // A popover (space or folder editor) scrolls on its own; a drag owns the pointer.
      if (this.#host.blocked() || (event.target as HTMLElement).closest?.("[role=dialog]")) return;
      if (this.#sliding) {
        if (swipe.active || Math.abs(event.deltaX) > Math.abs(event.deltaY)) event.preventDefault();
        return;
      }
      measure();
      const output = swipe.wheel(
        { deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, time: event.timeStamp },
        bounds(),
      );
      clearTimeout(endTimer);
      endTimer = setTimeout(() => this.apply(swipe.end(performance.now(), bounds())), swipe.endGapMs + 10);
      if (output.kind === "ignore") return;
      event.preventDefault();
      this.apply(output);
    };
    // Capture: a swipe that starts over the tab list (or any scrolling child) is seen first.
    element.addEventListener("wheel", onWheel, { passive: false, capture: true });

    // A finger on a touchscreen (ADR-031): same machine. `touch-action: pan-y` on the sidebar
    // leaves vertical pans to the browser (the tab list scrolls, and `pointercancel` ends ours);
    // horizontal moves reach us. Rows are not dragged by touch (see TreeDrag.pointerDown).
    let finger: number | null = null;
    const onTouchDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !event.isPrimary || this.#host.blocked()) return;
      if ((event.target as HTMLElement).closest?.("[role=dialog], input, textarea")) return;
      if (this.#sliding) return;
      finger = event.pointerId;
      measure();
      swipe.touchStart({ x: event.clientX, y: event.clientY, time: event.timeStamp });
    };
    const onTouchMove = (event: PointerEvent) => {
      if (event.pointerId !== finger) return;
      const output = swipe.touchMove({ x: event.clientX, y: event.clientY, time: event.timeStamp }, bounds());
      if (output.kind !== "ignore") this.apply(output);
    };
    const onTouchEnd = (event: PointerEvent) => {
      if (event.pointerId !== finger) return;
      finger = null;
      const wasSwiping = swipe.active;
      this.apply(event.type === "pointercancel" ? swipe.touchCancel() : swipe.touchEnd(event.timeStamp, bounds()));
      if (wasSwiping) this.#host.onLift();
    };
    element.addEventListener("pointerdown", onTouchDown, { capture: true });
    window.addEventListener("pointermove", onTouchMove);
    window.addEventListener("pointerup", onTouchEnd);
    window.addEventListener("pointercancel", onTouchEnd);
    return () => {
      clearTimeout(endTimer);
      clearTimeout(this.#settleTimer);
      element.removeEventListener("wheel", onWheel, { capture: true });
      element.removeEventListener("pointerdown", onTouchDown, { capture: true });
      window.removeEventListener("pointermove", onTouchMove);
      window.removeEventListener("pointerup", onTouchEnd);
      window.removeEventListener("pointercancel", onTouchEnd);
    };
  }

  #snapBack(): void {
    clearTimeout(this.#settleTimer);
    this.settling = false;
    this.offset = 0;
    this.swiping = false;
  }

  #commit(direction: 1 | -1): void {
    const neighbours = this.#host.neighbours();
    const target = direction === 1 ? neighbours.next : neighbours.previous;
    if (!target) return this.#snapBack();
    this.#switchingTo = target.id;
    this.swiping = false;
    this.settling = false;
    this.offset = 0;
    this.#instantSwitch = true;
    this.#host.switchTo(target.id);
    // Refused or lost: return to rest rather than getting stuck.
    this.#settleTimer = setTimeout(() => {
      if (this.#switchingTo === target.id) {
        this.#switchingTo = null;
        this.#snapBack();
      }
    }, SWITCH_TIMEOUT_MS);
  }
}
