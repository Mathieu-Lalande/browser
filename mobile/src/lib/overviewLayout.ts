/**
 * Geometry of the tab overview grid. Computed (not measured) so the zoom transition knows where
 * the active tab's card is before the grid is even rendered.
 */

export interface GridLayout {
  columns: number;
  padding: number;
  gap: number;
  cardWidth: number;
  cardHeight: number;
  /** Y of the first row, relative to the top of the scroll content. */
  top: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const CARD_ASPECT = 1.32;

export function gridLayout(width: number, top: number): GridLayout {
  const columns = width >= 900 ? 4 : width >= 600 ? 3 : 2;
  const padding = width >= 600 ? 20 : 14;
  const gap = width >= 600 ? 16 : 12;
  const cardWidth = Math.floor((width - padding * 2 - gap * (columns - 1)) / columns);
  return { columns, padding, gap, cardWidth, cardHeight: Math.round(cardWidth * CARD_ASPECT), top };
}

/** Position of card `index` within the scroll content. */
export function cardRect(layout: GridLayout, index: number): Rect {
  const column = index % layout.columns;
  const row = Math.floor(index / layout.columns);
  return {
    x: layout.padding + column * (layout.cardWidth + layout.gap),
    y: layout.top + row * (layout.cardHeight + layout.gap),
    width: layout.cardWidth,
    height: layout.cardHeight,
  };
}

export function contentHeight(layout: GridLayout, count: number, bottomInset: number): number {
  const rows = Math.max(1, Math.ceil(count / layout.columns));
  return layout.top + rows * layout.cardHeight + (rows - 1) * layout.gap + bottomInset;
}

/** Scroll offset that shows card `index` comfortably (centered when possible). */
export function scrollOffsetFor(layout: GridLayout, index: number, count: number, viewportHeight: number, bottomInset: number): number {
  if (index < 0) return 0;
  const rect = cardRect(layout, index);
  const max = Math.max(0, contentHeight(layout, count, bottomInset) - viewportHeight);
  const centered = rect.y + rect.height / 2 - viewportHeight / 2;
  return Math.min(max, Math.max(0, Math.round(centered)));
}

/** Height of a folder header in the overview grid (ADR-022). */
export const FOLDER_HEADER = 40;

/** A run of cards in the grid, below an optional full-width folder header. */
export interface GridSection {
  header: boolean;
  /** Cards shown (0 when the folder is collapsed or empty). */
  count: number;
}

export interface SectionedGrid {
  /** Every shown card, sections in order. */
  cards: Rect[];
  headers: Rect[];
  /** Bottom of the last line, in scroll content coordinates. */
  bottom: number;
}

/**
 * Card and header positions when cards are grouped by folder: each header takes a full line, its
 * cards start on the next one. Mirrors the flex-wrap grid (lines separated by `gap`).
 */
export function sectionedGrid(layout: GridLayout, sections: readonly GridSection[]): SectionedGrid {
  const cards: Rect[] = [];
  const headers: Rect[] = [];
  const width = layout.columns * layout.cardWidth + (layout.columns - 1) * layout.gap;
  let y = layout.top;
  for (const section of sections) {
    if (section.header) {
      headers.push({ x: layout.padding, y, width, height: FOLDER_HEADER });
      y += FOLDER_HEADER + layout.gap;
    }
    for (let i = 0; i < section.count; i++) {
      const rect = cardRect({ ...layout, top: y }, i);
      cards.push(rect);
    }
    const rows = Math.ceil(section.count / layout.columns);
    y += rows * (layout.cardHeight + layout.gap);
  }
  return { cards, headers, bottom: Math.max(layout.top, y - layout.gap) };
}

/** Scroll offset that shows `rect` comfortably (centered when possible) in content `height` px tall. */
export function scrollOffsetForRect(rect: Rect | undefined, contentBottom: number, viewportHeight: number, bottomInset: number): number {
  if (!rect) return 0;
  const max = Math.max(0, contentBottom + bottomInset - viewportHeight);
  const centered = rect.y + rect.height / 2 - viewportHeight / 2;
  return Math.min(max, Math.max(0, Math.round(centered)));
}

/** Transform that maps the full page rect onto `target` (scale from the page's top-left corner). */
export function zoomTransform(page: Rect, target: Rect): { scale: number; translateX: number; translateY: number } {
  const scale = target.width / page.width;
  // React Native scales around the center: compensate so the page lands on the card.
  const translateX = target.x + target.width / 2 - (page.x + page.width / 2);
  const translateY = target.y + (page.height * scale) / 2 - (page.y + page.height / 2);
  return { scale, translateX, translateY };
}
