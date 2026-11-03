import type { WebContents } from "electron";
import { readerPlainText } from "@shared/assistant/context";
import { sanitizeReaderArticle } from "@shared/reader";
import { extractArticle } from "../reader/page";

/**
 * Reading a page for the assistant (ADR-044): the reader extraction first (ADR-026, its own
 * isolated world, the result validated by `sanitizeReaderArticle`), else the page's visible
 * text; the selection through the same kind of isolated world. Main frame only, never a field's
 * value (`innerText` and the selection skip password fields), and nothing runs in the page's
 * own JavaScript world.
 */

/** Isolated worlds: … 1014–1015 autofill, 1016 notifications. */
export const ASSISTANT_WORLD_ID = 1017;

const MAX_TEXT = 400_000;
const MAX_SELECTION = 40_000;

const VISIBLE_TEXT_SCRIPT = `(() => { try { return String(document.body ? document.body.innerText : "").slice(0, ${MAX_TEXT}); } catch (e) { return ""; } })()`;
const SELECTION_SCRIPT = `(() => {
  try {
    const active = document.activeElement;
    if (active && (active.type === "password" || active.autocomplete === "cc-number")) return "";
    return String(window.getSelection() || "").slice(0, ${MAX_SELECTION});
  } catch (e) { return ""; }
})()`;

async function run(contents: WebContents, code: string): Promise<string> {
  try {
    const value: unknown = await contents.executeJavaScriptInIsolatedWorld(ASSISTANT_WORLD_ID, [{ code }]);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

/** The page's title and text (empty when nothing can be read). */
export async function readPage(contents: WebContents): Promise<{ title: string; url: string; text: string }> {
  const url = contents.getURL();
  const article = sanitizeReaderArticle(await extractArticle(contents), url);
  const text = article ? readerPlainText(article.content) : (await run(contents, VISIBLE_TEXT_SCRIPT)).slice(0, MAX_TEXT);
  return { title: (article?.title || contents.getTitle() || url).slice(0, 300), url, text };
}

export const readSelection = (contents: WebContents): Promise<string> => run(contents, SELECTION_SCRIPT);
