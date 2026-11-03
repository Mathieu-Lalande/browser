import type { Bounds } from "./types";

/**
 * Print preview (ADR-042): the options of the dialog, their validation, how they become Electron's
 * `printToPDF` / `print` options, and the dialog's geometry (the PDF preview is a native view main
 * places at `preview`, the overlay layer draws the rest).
 */

export type PrintOrientation = "portrait" | "landscape";
export type PrintMargins = "default" | "none" | "minimum";
/** "pdf": save as a PDF file; otherwise a system printer's name. */
export type PrintDestination = string;
export const PDF_DESTINATION = "pdf";

export interface PrintOptions {
  destination: PrintDestination;
  orientation: PrintOrientation;
  margins: PrintMargins;
  /** Percent, 10…200. */
  scale: number;
  background: boolean;
  /** "" for every page, else like "1-3, 5". */
  pages: string;
  copies: number;
}

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  destination: PDF_DESTINATION,
  orientation: "portrait",
  margins: "default",
  scale: 100,
  background: false,
  pages: "",
  copies: 1,
};

export interface PrintPrinter {
  name: string;
  displayName: string;
  isDefault: boolean;
}

/** What the dialog shows when it opens. */
export interface PrintPreviewInfo {
  title: string;
  layout: PrintLayout;
}

/** Result of an update or a print/save. */
export type PrintResult = { ok: true } | { ok: false; message: string };

const MAX_PAGES_TEXT = 200;

/** Page ranges ("1-3, 5") as 0-based `{from, to}` pairs, null when the text is invalid; [] for all pages. */
export function parsePageRanges(text: string): { from: number; to: number }[] | null {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length > MAX_PAGES_TEXT) return null;
  const ranges: { from: number; to: number }[] = [];
  for (const part of trimmed.split(",")) {
    const match = /^\s*(\d{1,4})\s*(?:-\s*(\d{1,4}))?\s*$/.exec(part);
    if (!match) return null;
    const from = Number(match[1]);
    const to = match[2] ? Number(match[2]) : from;
    if (from < 1 || to < from) return null;
    ranges.push({ from: from - 1, to: to - 1 });
  }
  return ranges;
}

export function isPrintOptions(value: unknown): value is PrintOptions {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.destination === "string" &&
    o.destination.length > 0 &&
    o.destination.length <= 256 &&
    (o.orientation === "portrait" || o.orientation === "landscape") &&
    (o.margins === "default" || o.margins === "none" || o.margins === "minimum") &&
    Number.isInteger(o.scale) &&
    (o.scale as number) >= 10 &&
    (o.scale as number) <= 200 &&
    typeof o.background === "boolean" &&
    typeof o.pages === "string" &&
    parsePageRanges(o.pages) !== null &&
    Number.isInteger(o.copies) &&
    (o.copies as number) >= 1 &&
    (o.copies as number) <= 99
  );
}

/** Electron's `printToPDF` options (margins in inches). */
export function pdfOptions(options: PrintOptions) {
  const margins = options.margins === "none" ? 0 : options.margins === "minimum" ? 0.2 : 0.4;
  const ranges = parsePageRanges(options.pages) ?? [];
  return {
    landscape: options.orientation === "landscape",
    printBackground: options.background,
    scale: options.scale / 100,
    margins: { top: margins, bottom: margins, left: margins, right: margins },
    pageRanges: ranges.map((range) => `${range.from + 1}-${range.to + 1}`).join(","),
    preferCSSPageSize: false,
  };
}

/** Electron's `webContents.print` options for a printer. */
export function printerOptions(options: PrintOptions) {
  const ranges = parsePageRanges(options.pages) ?? [];
  return {
    silent: true,
    deviceName: options.destination,
    landscape: options.orientation === "landscape",
    printBackground: options.background,
    scaleFactor: options.scale,
    copies: options.copies,
    margins: { marginType: options.margins === "none" ? ("none" as const) : options.margins === "minimum" ? ("printableArea" as const) : ("default" as const) },
    ...(ranges.length ? { pageRanges: ranges } : {}),
  };
}

export interface PrintLayout {
  /** The whole dialog. */
  card: Bounds;
  /** The PDF preview (a native view). */
  preview: Bounds;
  /** The options column. */
  panel: Bounds;
}

export const PRINT_PANEL_WIDTH = 300;
const MARGIN = 24;
const GAP = 12;

/** The dialog centered in the window (content size), the preview on the left, options on the right. */
export function printLayout(width: number, height: number): PrintLayout {
  const cardWidth = Math.max(0, Math.min(width - 2 * MARGIN, 1100));
  const cardHeight = Math.max(0, Math.min(height - 2 * MARGIN, 860));
  const card = { x: Math.round((width - cardWidth) / 2), y: Math.round((height - cardHeight) / 2), width: cardWidth, height: cardHeight };
  const panelWidth = Math.min(PRINT_PANEL_WIDTH, Math.max(0, cardWidth - 2 * GAP));
  const panel = { x: card.x + card.width - panelWidth, y: card.y, width: panelWidth, height: card.height };
  const preview = {
    x: card.x + GAP,
    y: card.y + GAP,
    width: Math.max(0, card.width - panelWidth - 2 * GAP),
    height: Math.max(0, card.height - 2 * GAP),
  };
  return { card, preview, panel };
}
