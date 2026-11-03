import type { WebContents } from "electron";
import { mapReaderImages, readerImageSources, sanitizeReaderArticle, type ReaderArticle } from "@shared/reader";
import type { TabId } from "@shared/types";
import { fetchImageDataUrl } from "../favicons";
import { faviconRequestUrl } from "../privacy";
import { appServices } from "../app-services-ref";
import type { BrowserController } from "../window";
import { extractArticle } from "./page";

/**
 * Reader mode, desktop side (ADR-026). Main extracts the article (isolated world), validates it
 * (`sanitizeReaderArticle`), fetches its first images through the tab's own session as `data:`
 * (the chrome UI's CSP is `img-src 'self' data:`, ADR-018) and keeps it for the chrome UI, which
 * draws it in place of the page view. The page's origin never renders anything of the reader.
 */

/** Images fetched per article; the others are left out. */
const MAX_IMAGES = 12;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 5000;
/** Articles kept (most recent last), by tab id. */
const MAX_ARTICLES = 16;

/** Fetches the first images like favicons are (tab session, shields, HTTPS-Only); the others are dropped. */
async function withImages(contents: WebContents, article: ReaderArticle): Promise<ReaderArticle> {
  const sources = [...new Set(readerImageSources(article.content))].slice(0, MAX_IMAGES);
  const fetched = new Map<string, string | null>();
  await Promise.all(
    sources.map(async (src) => {
      const url = faviconRequestUrl(contents, src, article.url);
      fetched.set(src, url ? await fetchImageDataUrl(contents.session, url, MAX_IMAGE_BYTES, IMAGE_TIMEOUT_MS).catch(() => null) : null);
    }),
  );
  return { ...article, content: mapReaderImages(article.content, (src) => fetched.get(src) ?? null) };
}

/** The articles extracted for tabs in reader mode (most recent last), one extraction per tab at a time. */
export class ReaderService {
  private readonly articles = new Map<TabId, ReaderArticle>();
  /** One extraction per tab at a time (a double press of the shortcut). */
  private readonly busy = new Set<TabId>();

  /** "Mode lecture": shows the active page's article in place of the page, or goes back to the page. */
  async toggle(c: BrowserController, tabId: TabId): Promise<void> {
    const tab = c.tabs.getState().tabs.find((entry) => entry.id === tabId);
    if (!tab) return;
    if (tab.reader) {
      c.tabs.setReader(tabId, false);
      return;
    }
    const contents = c.tabs.pageOf(tabId);
    if (!contents || this.busy.has(tabId)) return;
    this.busy.add(tabId);
    try {
      const url = contents.getURL();
      const raw = await extractArticle(contents);
      if (contents.isDestroyed() || contents.getURL() !== url) return;
      const article = sanitizeReaderArticle(raw, url);
      // Nothing worth reading: the page stays as it is (the address bar only offers pages that look readable).
      if (!article) return;
      const complete = await withImages(contents, article);
      if (contents.isDestroyed() || contents.getURL() !== url) return;
      this.remember(tabId, complete);
      c.tabs.setReader(tabId, true, url);
    } finally {
      this.busy.delete(tabId);
    }
  }

  /** The article the chrome UI draws for a tab in reader mode (null otherwise). */
  article(c: BrowserController, tabId: TabId): ReaderArticle | null {
    const tab = c.tabs.getState().tabs.find((entry) => entry.id === tabId);
    const article = this.articles.get(tabId);
    return tab?.reader && article && article.url === c.tabs.pageOf(tabId)?.getURL() ? article : null;
  }

  private remember(tabId: TabId, article: ReaderArticle): void {
    this.articles.delete(tabId);
    this.articles.set(tabId, article);
    if (this.articles.size > MAX_ARTICLES) this.articles.delete(this.articles.keys().next().value!);
  }
}

// Function facades over the app's reader service (commands and IPC handlers).
export const toggleReader = (c: BrowserController, tabId: TabId): Promise<void> => appServices().reader.toggle(c, tabId);
export const readerArticle = (c: BrowserController, tabId: TabId): ReaderArticle | null => appServices().reader.article(c, tabId);
