import { randomUUID } from "node:crypto";
import type { ExtensionReview } from "@shared/extensions";

/** Unanswered confirmations count as "no" after this long (window closed meanwhile…). */
const REVIEW_TIMEOUT_MS = 10 * 60_000;

interface Pending {
  review: ExtensionReview;
  resolve(accepted: boolean): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Permission confirmations before a Web Store install or update (ADR-049). Main keeps each one
 * under a random id; the overlay panel reads it by that id and answers. Dismissing the panel
 * (Escape, outside click, another popover) answers no.
 */
export class ExtensionReviews {
  private readonly pending = new Map<string, Pending>();

  /** Shows `review` (`show` opens the panel for its id); resolves to the user's answer. */
  ask(review: ExtensionReview, show: (reviewId: string) => void): Promise<boolean> {
    const reviewId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.answer(reviewId, false), REVIEW_TIMEOUT_MS);
      this.pending.set(reviewId, { review, resolve, timer });
      show(reviewId);
    });
  }

  get(reviewId: string): ExtensionReview | null {
    return this.pending.get(reviewId)?.review ?? null;
  }

  answer(reviewId: string, accepted: boolean): void {
    const pending = this.pending.get(reviewId);
    if (!pending) return;
    this.pending.delete(reviewId);
    clearTimeout(pending.timer);
    pending.resolve(accepted);
  }
}
