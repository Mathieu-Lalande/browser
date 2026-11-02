import type { WebContents } from "electron";
import { MAX_BATCH_CHARS, MAX_BATCH_SEGMENTS, sanitizeSegments } from "@shared/translate/segments";
import type { Translator } from "@shared/translate/translator";
import { applyTranslations, nextSegments, startWalker, waitForContent } from "./page";

/**
 * One translation of one document (ADR-036): starts the walker, then translates batch after batch
 * (the viewport first, the rest progressively), then waits for new content (debounced in the page)
 * a bounded number of times. Cancelled by a new document, "Afficher l'original" or a failure.
 */

/** New-content rounds per document (an endless feed stops being translated after this). */
const MAX_ROUNDS = 200;

export interface RunEvents {
  /** The provider detected the source language (when it was not known). */
  detected(language: string): void;
  /** A batch was written into the page. */
  applied(): void;
  /** Everything found so far was sent: the run now waits for new content. */
  drained(): void;
}

export class TranslationRun {
  private cancelled = false;

  constructor(
    private readonly contents: WebContents,
    private readonly translator: Translator,
    private readonly from: string | null,
    readonly to: string,
    private readonly events: RunEvents,
  ) {}

  get alive(): boolean {
    return !this.cancelled && !this.contents.isDestroyed();
  }

  cancel(): void {
    this.cancelled = true;
  }

  /** Resolves when the run ends; rejects with the provider's `TranslationError`. */
  async run(): Promise<void> {
    await startWalker(this.contents);
    let rounds = 0;
    while (this.alive) {
      const segments = sanitizeSegments(await nextSegments(this.contents, MAX_BATCH_CHARS, MAX_BATCH_SEGMENTS));
      if (!this.alive) return;
      if (!segments.length) {
        this.events.drained();
        if (++rounds > MAX_ROUNDS || !(await waitForContent(this.contents))) return;
        continue;
      }
      const result = await this.translator.translate(
        segments.map((segment) => segment.text),
        this.from,
        this.to,
      );
      if (!this.alive) return;
      if (!this.from && result.detected) this.events.detected(result.detected);
      const pairs = segments.flatMap((segment, index): [number, string][] => {
        const text = result.texts[index];
        return text ? [[segment.id, text]] : [];
      });
      await applyTranslations(this.contents, pairs);
      if (this.alive) this.events.applied();
    }
  }
}
