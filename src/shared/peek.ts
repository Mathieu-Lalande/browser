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

/** Height of the AI summary strip between the header and the page (ADR-059), when shown. */
export const PEEK_SUMMARY_HEIGHT = 140;

/** The card centered in `area` (the page area of the window), ~80% of it; `summary`: the strip is shown. */
export function peekLayout(area: Bounds, scale = PEEK_SCALE, summary = false): PeekLayout {
  const size = (full: number, min: number) => Math.max(0, Math.min(full, Math.max(min, Math.round(full * scale))));
  const width = size(area.width, PEEK_MIN_WIDTH);
  const height = size(area.height, PEEK_MIN_HEIGHT);
  const card = {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  };
  const top = PEEK_HEADER_HEIGHT + (summary ? PEEK_SUMMARY_HEIGHT : 0);
  const page = {
    x: card.x + PEEK_INSET,
    y: card.y + top,
    width: Math.max(0, width - 2 * PEEK_INSET),
    height: Math.max(0, height - top - PEEK_INSET),
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
  /** The AI summary (ADR-059): "off" when the assistant is not set up (or a private window). */
  summary: PeekSummary;
}

export interface PeekSummary {
  status: "off" | "idle" | "loading" | "done" | "error";
  bullets: string[];
  message?: string;
}

export type PeekAction = "open-tab" | "open-split" | "close" | "summarize";

export const isPeekAction = (value: unknown): value is PeekAction => value === "open-tab" || value === "open-split" || value === "close" || value === "summarize";

// --- AI summary (ADR-059) ---------------------------------------------------------------------

/** Characters of the page's text sent at most (the reader-mode text, else the visible text). */
export const SUMMARY_MAX_CHARS = 24_000;
const MAX_BULLETS = 4;
const MAX_BULLET = 240;

export const SUMMARY_SCHEMA = {
  type: "object",
  properties: { bullets: { type: "array", items: { type: "string" } } },
  required: ["bullets"],
  additionalProperties: false,
} as const;

export function summaryPrompt(title: string, text: string, language: "fr" | "en"): string {
  return [
    `Summarize this web page in ${language === "fr" ? "French" : "English"}: 3 short bullet points, the facts that matter to decide whether to read it.`,
    "No preamble, no markdown, plain sentences.",
    "",
    `Title: ${title.slice(0, 300)}`,
    "",
    text.slice(0, SUMMARY_MAX_CHARS),
  ].join("\n");
}

/** The validated bullets of the structured answer (at most 4, trimmed); empty when unusable. */
export function parseSummary(json: string): string[] {
  try {
    const bullets = (JSON.parse(json) as { bullets?: unknown }).bullets;
    if (!Array.isArray(bullets)) return [];
    return bullets
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.replace(/^[\s•*-]+/u, "").replace(/\s+/gu, " ").trim().slice(0, MAX_BULLET))
      .filter(Boolean)
      .slice(0, MAX_BULLETS);
  } catch {
    return [];
  }
}

/** Only what a page may open can be peeked: http(s) and about:blank, never file:, data: or browser: (ADR-021). */
export const isPeekableUrl = (url: string): boolean => isPageOpenableUrl(url);
