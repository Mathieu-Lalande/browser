import type { WebContents } from "electron";
import { PAGE_LANGUAGE_SCRIPT, TRANSLATE_WALKER } from "@shared/translate/page-script";

/**
 * The page side of translation on the desktop (ADR-036): the shared walker runs in an isolated
 * world, like the password and reader scripts (ADR-025, ADR-026). It shares the page's DOM but
 * none of its JavaScript: the page can neither call it nor see the texts going out, and pages
 * still get no preload (ADR-003). Results come back as the scripts' return values: no channel is
 * opened. Main frame only.
 */

/** Isolated worlds: 1001 cosmetics … 1011 media hub; 1012 translation. */
export const TRANSLATE_WORLD_ID = 1012;

/** The walker, created once per document in the isolated world. */
const WALKER = `(globalThis.__browserTranslate || (globalThis.__browserTranslate = ${TRANSLATE_WALKER}()))`;

async function run(contents: WebContents, code: string): Promise<unknown> {
  if (contents.isDestroyed()) return null;
  try {
    return await contents.executeJavaScriptInIsolatedWorld(TRANSLATE_WORLD_ID, [{ code }]);
  } catch {
    return null;
  }
}

/** What the page declares (`<html lang>`, `Content-Language`): untrusted, see `pageLanguage`. */
export const declaredLanguage = (contents: WebContents) => run(contents, PAGE_LANGUAGE_SCRIPT);

export const startWalker = (contents: WebContents) => run(contents, `${WALKER}.start()`);

/** The next texts `[[id, text], …]` (to check with `sanitizeSegments`). */
export const nextSegments = (contents: WebContents, maxChars: number, maxCount: number) =>
  run(contents, `${WALKER}.next(${maxChars | 0}, ${maxCount | 0})`);

/** Writes translations back as text (the walker checks each node still holds what was sent). */
export const applyTranslations = (contents: WebContents, pairs: [number, string][]) => run(contents, `${WALKER}.apply(${JSON.stringify(pairs)})`);

/** Resolves true when new content waits for translation; false once stopped or the page left. */
export const waitForContent = async (contents: WebContents) => (await run(contents, `${WALKER}.wait()`)) === true;

/** Puts the original texts back (and stops watching the page). */
export const restoreOriginal = (contents: WebContents) => run(contents, `globalThis.__browserTranslate ? globalThis.__browserTranslate.restore() : 0`);
