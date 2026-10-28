import type { Bounds } from "./types";
import { isPageOpenableUrl } from "./url";

/**
 * Link peek (ADR-027): a link previewed in a floating card above the current page, without
 * leaving it. Pure rules of the desktop card (geometry, actions); the phone's sheet gesture is in
 * `mobile/src/lib/gestures.ts`.
 */

/** Share of the page area the card takes, in each direction. */
export const PEEK_SCALE = 0.8;
/** Height of the card's header (title, address, buttons), drawn by the overlay layer. */
export const PEEK_HEADER_HEIGHT = 48;
/** Margin between the card's edge and the page view inside it (sides and bottom). */
export const PEEK_INSET = 6;
/** The card never gets smaller than this (unless the page area itself is smaller). */
export const PEEK_MIN_WIDTH = 360;
export const PEEK_MIN_HEIGHT = 240;

export interface PeekLayout {
  /** The whole card, header included (window content coordinates). */
  card: Bounds;
  /** Where the peeked page's view goes, inside the card below the header. */
  page: Bounds;
}

/** The card centered in `area` (the page area of the window), ~80% of it. */
export function peekLayout(area: Bounds, scale = PEEK_SCALE): PeekLayout {
  const size = (full: number, min: number) => Math.max(0, Math.min(full, Math.max(min, Math.round(full * scale))));
  const width = size(area.width, PEEK_MIN_WIDTH);
  const height = size(area.height, PEEK_MIN_HEIGHT);
  const card = {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  };
  const page = {
    x: card.x + PEEK_INSET,
    y: card.y + PEEK_HEADER_HEIGHT,
    width: Math.max(0, width - 2 * PEEK_INSET),
    height: Math.max(0, height - PEEK_HEADER_HEIGHT - PEEK_INSET),
  };
  return { card, page };
}

/** What the card's header shows (sent by main to the overlay layer). */
export interface PeekState {
  url: string;
  title: string;
  isLoading: boolean;
  /** Whether "Ouvrir en vue scindée" is possible (the split is not full). */
  canSplit: boolean;
  card: Bounds;
}

export type PeekAction = "open-tab" | "open-split" | "close";

export const isPeekAction = (value: unknown): value is PeekAction => value === "open-tab" || value === "open-split" || value === "close";

/** Only what a page may open can be peeked: http(s) and about:blank, never file:, data: or browser: (ADR-021). */
export const isPeekableUrl = (url: string): boolean => isPageOpenableUrl(url);
