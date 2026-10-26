import type { Bounds, SplitState, TabId } from "./types";

/** At most this many tabs side by side (2×2 grid). */
export const MAX_SPLIT_TABS = 4;
/** Space between panes, in px: chrome UI shows there (dividers, focus outline). */
export const SPLIT_GAP = 8;
/** Smallest pane share along a divider. */
export const MIN_RATIO = 0.2;
const MAX_RATIO = 1 - MIN_RATIO;

export const clampRatio = (ratio: number) => (Number.isFinite(ratio) ? Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)) : 0.5);

/** Divider handles, in the same coordinates as the pane rectangles. */
export interface SplitDivider {
  axis: "x" | "y";
  /** The gap rectangle the divider occupies (receives the drag). */
  rect: Bounds;
}

export interface SplitLayout {
  panes: Bounds[];
  dividers: SplitDivider[];
}

/** Splits `length` starting at `start` into two parts separated by `gap`, the first one `ratio` of the rest. */
function cut(start: number, length: number, ratio: number, gap: number): [number, number, number] {
  const usable = Math.max(0, length - gap);
  const first = Math.round(usable * clampRatio(ratio));
  // [first start, first length, second start] — the second length is `start + length - secondStart`.
  return [start, first, start + first + gap];
}

/**
 * Pane rectangles (in `area` coordinates, integers, never overlapping) for `count` panes, plus the
 * divider gaps between them. 1 pane fills the area; 2 are two columns; 3 are a full-height left
 * column and a right column split in two; 4 are a 2×2 grid. Pane order: left column top to bottom,
 * then right column top to bottom.
 */
export function splitLayout(area: Bounds, count: number, ratioX = 0.5, ratioY = 0.5, gap = SPLIT_GAP): SplitLayout {
  const x = Math.round(area.x);
  const y = Math.round(area.y);
  const width = Math.max(0, Math.round(area.width));
  const height = Math.max(0, Math.round(area.height));
  if (count <= 1) return { panes: [{ x, y, width, height }], dividers: [] };

  const [left, leftWidth, right] = cut(x, width, ratioX, gap);
  const rightWidth = Math.max(0, x + width - right);
  const [top, topHeight, bottom] = cut(y, height, ratioY, gap);
  const bottomHeight = Math.max(0, y + height - bottom);
  const xDivider: SplitDivider = { axis: "x", rect: { x: left + leftWidth, y, width: gap, height } };

  if (count === 2) {
    return {
      panes: [
        { x: left, y, width: leftWidth, height },
        { x: right, y, width: rightWidth, height },
      ],
      dividers: [xDivider],
    };
  }
  const rows = (colX: number, colWidth: number): Bounds[] => [
    { x: colX, y: top, width: colWidth, height: topHeight },
    { x: colX, y: bottom, width: colWidth, height: bottomHeight },
  ];
  if (count === 3) {
    return {
      panes: [{ x: left, y, width: leftWidth, height }, ...rows(right, rightWidth)],
      dividers: [xDivider, { axis: "y", rect: { x: right, y: top + topHeight, width: rightWidth, height: gap } }],
    };
  }
  return {
    panes: [...rows(left, leftWidth), ...rows(right, rightWidth)],
    dividers: [xDivider, { axis: "y", rect: { x, y: top + topHeight, width, height: gap } }],
  };
}

/**
 * The divider ratio for a pointer position along its axis (dragging the divider).
 * `start`/`length` describe the area along that axis.
 */
export function ratioAt(pointer: number, start: number, length: number, gap = SPLIT_GAP): number {
  const usable = length - gap;
  if (usable <= 0) return 0.5;
  return clampRatio((pointer - start - gap / 2) / usable);
}

/** Split after "open `tabId` side by side with the active tab". Null when that is not possible. */
export function splitWith(split: SplitState | null, activeId: TabId | null, tabId: TabId): SplitState | null {
  if (!activeId || activeId === tabId) return null;
  if (split?.tabIds.includes(activeId)) {
    if (split.tabIds.includes(tabId) || split.tabIds.length >= MAX_SPLIT_TABS) return null;
    return { ...split, tabIds: [...split.tabIds, tabId] };
  }
  return { tabIds: [activeId, tabId], ratioX: 0.5, ratioY: 0.5 };
}

/** Split once `tabId` left it (closed, moved away): null when fewer than 2 tabs remain. */
export function splitWithout(split: SplitState | null, tabId: TabId): SplitState | null {
  if (!split?.tabIds.includes(tabId)) return split;
  const tabIds = split.tabIds.filter((id) => id !== tabId);
  return tabIds.length >= 2 ? { ...split, tabIds } : null;
}
