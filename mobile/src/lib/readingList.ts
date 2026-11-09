import type { ReaderArticle } from "@shared/reader";
import { addReadingItem, createReadingItem, readingId, removeReadingItem, type ReadingItem } from "@shared/reading-list";

/**
 * "Lire plus tard" on the phone (ADR-047): the shared model (`@shared/reading-list`) applied to
 * the app's store. A page is added at once, then its reader-mode text (the reader's injection,
 * ADR-026) completes it when the page answers.
 */

export function isInReadingList(list: readonly ReadingItem[], url: string): boolean {
  if (!/^https?:/i.test(url)) return false;
  const id = readingId(url);
  return list.some((item) => item.id === id);
}

/** The page menu's action: adds the page (no text yet), or takes it off the list. */
export function toggleReadLater(list: readonly ReadingItem[], page: { url: string; title: string }, now: number): { list: ReadingItem[]; added: boolean } {
  if (isInReadingList(list, page.url)) return { list: removeReadingItem(list, readingId(page.url)), added: false };
  const item = createReadingItem(page, null, now);
  return item ? { list: addReadingItem(list, item), added: true } : { list: [...list], added: false };
}

/** The extracted article of a page just added: its offline text, title and site name. Not listed any more: nothing. */
export function withArticle(list: readonly ReadingItem[], article: ReaderArticle, now: number): ReadingItem[] {
  const existing = list.find((item) => item.id === readingId(article.url));
  if (!existing) return [...list];
  const item = createReadingItem({ url: existing.url, title: existing.title }, article, existing.addedAt || now);
  return item ? list.map((entry) => (entry.id === item.id ? { ...item, readAt: entry.readAt } : entry)) : [...list];
}

/** Unread first (newest first), then read. */
export function readingSections(list: readonly ReadingItem[]): { unread: ReadingItem[]; read: ReadingItem[] } {
  return { unread: list.filter((item) => item.readAt === null), read: list.filter((item) => item.readAt !== null) };
}
