import type { WebContents } from "electron";
import { Emitter } from "@shared/emitter";
import { sanitizeReaderArticle, type ReaderArticle } from "@shared/reader";
import {
  addReadingItem,
  createReadingItem,
  readingEntries,
  readingId,
  removeReadingItem,
  setReadingRead,
  type ReadingEntry,
  type ReadingItem,
} from "@shared/reading-list";
import type { TabId } from "@shared/types";
import type { WindowPort } from "../ports";

/** Where the list lives (the profile's `reading-list.json`). */
export interface ReadingStore {
  list(): readonly ReadingItem[];
  save(next: readonly ReadingItem[]): void;
}

export interface ReadingDeps {
  store: ReadingStore;
  /** Readability in the page's isolated world (ADR-026), unvalidated. */
  extract(contents: WebContents): Promise<unknown>;
  now?: () => number;
}

/**
 * "Lire plus tard" (ADR-047): the profile's reading list. Adding a page also keeps an offline copy
 * of its reader-mode text (the same extraction and validation as reader mode, then plain
 * paragraphs only), capped per item and for the whole list. Never from a private window.
 */
export class ReadingListService {
  private readonly changes = new Emitter<void>();
  private readonly busy = new Set<string>();

  constructor(private readonly deps: ReadingDeps) {}

  entries(): ReadingEntry[] {
    return readingEntries(this.deps.store.list());
  }

  get(id: string): ReadingItem | null {
    return this.deps.store.list().find((item) => item.id === id) ?? null;
  }

  has(url: string): boolean {
    if (!/^https?:/i.test(url)) return false;
    const id = readingId(url);
    return this.deps.store.list().some((item) => item.id === id);
  }

  /**
   * The command, the page menu and the address bar button: adds the tab's page (with its text),
   * or takes it off the list when it is already there. Nothing for a private window.
   */
  async toggleTab(window: Pick<WindowPort, "isPrivate" | "tabs">, tabId: TabId): Promise<ReadingEntry | null> {
    if (window.isPrivate) return null;
    const tab = window.tabs.getState().tabs.find((entry) => entry.id === tabId);
    if (!tab || !/^https?:/i.test(tab.url)) return null;
    if (this.has(tab.url)) {
      this.remove(readingId(tab.url));
      return null;
    }
    return this.addPage({ url: tab.url, title: tab.title }, window.tabs.pageOf(tabId));
  }

  /** Adds a page; `contents` (its live page) gives the offline text when it reads as an article. */
  async addPage(input: { url: string; title: string }, contents: WebContents | null): Promise<ReadingEntry | null> {
    const id = /^https?:/i.test(input.url) ? readingId(input.url) : null;
    if (!id || this.busy.has(id)) return null;
    this.busy.add(id);
    try {
      const article = contents ? await this.article(contents, input.url) : null;
      const item = createReadingItem(input, article, this.now());
      if (!item) return null;
      this.commit(addReadingItem(this.deps.store.list(), item));
      return this.entries().find((entry) => entry.id === item.id) ?? null;
    } finally {
      this.busy.delete(id);
    }
  }

  setRead(id: string, read: boolean): void {
    if (this.get(id)) this.commit(setReadingRead(this.deps.store.list(), id, read, this.now()));
  }

  remove(id: string): void {
    if (this.get(id)) this.commit(removeReadingItem(this.deps.store.list(), id));
  }

  /** Synced items from another device (ADR-019), already merged by the adapter. */
  replace(next: readonly ReadingItem[]): void {
    this.commit(next);
  }

  onChanged(listener: () => void): () => void {
    return this.changes.on(listener);
  }

  private async article(contents: WebContents, url: string): Promise<ReaderArticle | null> {
    if (contents.isDestroyed() || contents.getURL() !== url) return null;
    try {
      const raw = await this.deps.extract(contents);
      return contents.isDestroyed() || contents.getURL() !== url ? null : sanitizeReaderArticle(raw, url);
    } catch {
      return null;
    }
  }

  private commit(next: readonly ReadingItem[]): void {
    this.deps.store.save(next);
    this.changes.emit();
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }
}
