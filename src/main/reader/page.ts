import type { WebContents } from "electron";
import { READER_CHECK_SCRIPT, READER_EXTRACT_SCRIPT } from "@shared/reader";

/**
 * Reader mode page scripts (ADR-026). Like the password scripts (ADR-025) they run in an isolated
 * world: they share the page's DOM but none of its JavaScript, so the page can neither see nor
 * patch Readability, and pages still get no preload (ADR-003). Main frame only.
 */

/** Isolated worlds: 1001 cosmetic filtering, 1002–1003 media, 1004–1005 passwords. */
export const READER_WORLD_ID = 1006;

/** Readability's `isProbablyReaderable` on the tab's document; false on any failure. */
export async function isPageReaderable(contents: WebContents): Promise<boolean> {
  try {
    return (await contents.executeJavaScriptInIsolatedWorld(READER_WORLD_ID, [{ code: READER_CHECK_SCRIPT }])) === true;
  } catch {
    return false;
  }
}

/** The article as the page script returned it: untrusted, to be checked by `sanitizeReaderArticle`. */
export async function extractArticle(contents: WebContents): Promise<unknown> {
  try {
    return await contents.executeJavaScriptInIsolatedWorld(READER_WORLD_ID, [{ code: READER_EXTRACT_SCRIPT }]);
  } catch {
    return null;
  }
}
