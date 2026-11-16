/**
 * Presentation mode of the reader (ADR-058): the article alone, full screen, in large type. Pure
 * keyboard map and section lookup, shared by the desktop view (and testable without a DOM).
 */

export type PresentationAction = "next-section" | "previous-section" | "next-page" | "previous-page" | "first" | "last" | "larger" | "smaller" | "exit";

/** What a key does in presentation mode (null: left to the browser, e.g. Tab). */
export function presentationKeyAction(key: string, shift: boolean): PresentationAction | null {
  switch (key) {
    case "ArrowRight":
      return "next-section";
    case "ArrowLeft":
      return "previous-section";
    case "ArrowDown":
    case "PageDown":
      return "next-page";
    case "ArrowUp":
    case "PageUp":
      return "previous-page";
    case " ":
      return shift ? "previous-page" : "next-page";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "+":
    case "=":
      return "larger";
    case "-":
      return "smaller";
    case "Escape":
      return "exit";
    default:
      return null;
  }
}

/**
 * The section to go to: tops of the headings (in px from the top of the scrolled content), the
 * current scroll offset and the direction. A small margin keeps a heading just under the top from
 * counting as "next". Null when there is none in that direction.
 */
export function sectionTarget(tops: readonly number[], scrollTop: number, direction: 1 | -1, margin = 8): number | null {
  if (direction > 0) return tops.find((top) => top > scrollTop + margin) ?? null;
  const before = tops.filter((top) => top < scrollTop - margin);
  return before.length ? before[before.length - 1]! : scrollTop > margin ? 0 : null;
}

/** One "page": most of the visible height, so a line stays visible across the turn. */
export const pageStep = (viewportHeight: number): number => Math.max(40, Math.round(viewportHeight * 0.88));
