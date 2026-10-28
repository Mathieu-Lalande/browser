/**
 * Gesture thresholds, kept pure (and marked as worklets) so they run on the UI thread inside
 * Reanimated/Gesture Handler callbacks and can be unit tested.
 */

/** Fraction of the width a horizontal swipe must travel to commit (unless flung). */
export const SWIPE_COMMIT_RATIO = 0.28;
/** A fling faster than this (pt/s) commits even if short… */
export const SWIPE_FLING_VELOCITY = 650;
/** …as long as it moved at least this far, in the same direction. */
export const SWIPE_MIN_DISTANCE = 24;
/** Swiping the address bar up by this much (or flinging up) opens the tab overview. */
export const SWIPE_UP_DISTANCE = 56;

/**
 * Outcome of a horizontal swipe: 1 (towards the next item: finger moved left), -1 (previous:
 * finger moved right) or 0 (snap back).
 */
export function resolveHorizontalSwipe(translationX: number, velocityX: number, width: number): -1 | 0 | 1 {
  "worklet";
  const distance = Math.abs(translationX);
  const direction: -1 | 1 = translationX < 0 ? 1 : -1;
  if (distance >= width * SWIPE_COMMIT_RATIO) return direction;
  const flungSameWay = Math.sign(velocityX) === Math.sign(translationX) && Math.abs(velocityX) >= SWIPE_FLING_VELOCITY;
  return distance >= SWIPE_MIN_DISTANCE && flungSameWay ? direction : 0;
}

/**
 * The tab overview pager (ADR-022): the page a horizontal swipe leads to from page `index` of
 * `count`: the next one (finger moved left), the previous one, or the same (snap back, or no page
 * that way).
 */
export function pagerTarget(index: number, count: number, translationX: number, velocityX: number, width: number): number {
  "worklet";
  const step = resolveHorizontalSwipe(translationX, velocityX, width);
  const next = index + step;
  return next >= 0 && next < count ? next : index;
}

/** Whether a vertical swipe on the address bar asks for the tab overview. */
export function isSwipeUp(translationY: number, velocityY: number): boolean {
  "worklet";
  return translationY <= -SWIPE_UP_DISTANCE || (translationY <= -SWIPE_MIN_DISTANCE && velocityY <= -SWIPE_FLING_VELOCITY);
}

/** Cards fly away when swiped past this fraction of their width (or flung). */
export const DISMISS_RATIO = 0.4;

export function shouldDismissCard(translationX: number, velocityX: number, cardWidth: number): boolean {
  "worklet";
  if (Math.abs(translationX) >= cardWidth * DISMISS_RATIO) return true;
  return Math.abs(translationX) >= SWIPE_MIN_DISTANCE && Math.sign(velocityX) === Math.sign(translationX) && Math.abs(velocityX) >= SWIPE_FLING_VELOCITY * 1.2;
}

/** iOS-like rubber band: movement beyond the end is resisted. */
export function rubberBand(offset: number, dimension: number, coefficient = 0.55): number {
  "worklet";
  const sign = offset < 0 ? -1 : 1;
  const distance = Math.abs(offset);
  return sign * (1 - 1 / ((distance * coefficient) / dimension + 1)) * dimension;
}

// --- Toolbar collapse while scrolling ---------------------------------------------------------

export interface CollapseState {
  collapsed: boolean;
  /** Scroll offset where the current scroll direction started. */
  anchorY: number;
  lastY: number;
}

export const COLLAPSE_DELTA = 24;
/** Near the top of the page the toolbar is always shown. */
export const TOP_ZONE = 32;

export const initialCollapse: CollapseState = { collapsed: false, anchorY: 0, lastY: 0 };

/**
 * Safari-like toolbar: collapses after scrolling down a little, expands after scrolling up a
 * little or when back near the top. Small jitters (and iOS bounce at the bottom) are ignored.
 */
export function nextCollapse(state: CollapseState, y: number, contentHeight: number, viewportHeight: number): CollapseState {
  "worklet";
  const maxY = Math.max(0, contentHeight - viewportHeight);
  // Overscroll (rubber band) past either end says nothing about the user's intent.
  if (y < 0 || y > maxY + 1) return state.collapsed && y < 0 ? { collapsed: false, anchorY: 0, lastY: 0 } : state;
  if (y <= TOP_ZONE) return { collapsed: false, anchorY: y, lastY: y };
  const goingDown = y > state.lastY;
  const wasGoingDown = state.lastY >= state.anchorY;
  const anchorY = goingDown === wasGoingDown ? state.anchorY : state.lastY;
  let collapsed = state.collapsed;
  if (goingDown && y - anchorY >= COLLAPSE_DELTA) collapsed = true;
  if (!goingDown && anchorY - y >= COLLAPSE_DELTA) collapsed = false;
  return { collapsed, anchorY, lastY: y };
}
