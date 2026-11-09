import { t } from "@shared/i18n";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { clipboard, dialog, type WebContents } from "electron";
import { annotationsToJson, annotationsToMarkdown, type AnnotationExportFormat } from "@shared/annotations/export";
import {
  addHighlight,
  annotationUrl,
  emptyAnnotations,
  highlightsFor,
  markOf,
  noteFor,
  removeHighlight,
  removePage,
  setPageNote,
  updateHighlight,
  type AnnotationsData,
  type Highlight,
  type HighlightColor,
  type HighlightPatch,
  type AnnotationResult,
  type AnnotationsList,
  type TabAnnotations,
} from "@shared/annotations/model";
import { Channels } from "@shared/ipc";
import type { TabId } from "@shared/types";
import { profile } from "../profile";
import type { WindowDirectory, WindowPort } from "../ports";
import { applyMarks, captureSelection, documentChanged, scrollToMark, type MarkClick } from "./page";

/**
 * Notes and highlights, desktop side (ADR-037). Each window has a `PageAnnotator`: it draws the
 * highlights of its tabs' pages (at each new document, after each change), turns the selection
 * into a highlight, and opens the popover when one is clicked. What it reads and writes is the
 * window's `AnnotationBook`: the profile's (`annotations.json`, synced when opted in), or, in a
 * private window, one kept in memory for that window only (ADR-014): it goes with the window.
 */

/** Where a window's annotations live. */
interface AnnotationBook {
  readonly data: AnnotationsData;
  readonly isPrivate: boolean;
  save(next: AnnotationsData): void;
}

/** The profile's book: every normal window shares it. */
const profileBook: AnnotationBook = {
  get data() {
    return profile().annotations;
  },
  isPrivate: false,
  save(next) {
    profile().saveAnnotations(next);
    bookChanged(profileBook);
  },
};

/** A private window's book: in memory, for that window only. */
class MemoryBook implements AnnotationBook {
  data = emptyAnnotations();
  readonly isPrivate = true;
  save(next: AnnotationsData): void {
    this.data = next;
    bookChanged(this);
  }
}

/** Every window using `book` redraws its pages and tells its UIs. */
function bookChanged(book: AnnotationBook): void {
  for (const c of windows?.all() ?? []) {
    const annotator = annotators.get(c);
    if (!annotator || annotator.book !== book) continue;
    annotator.refreshAll();
    c.send(Channels.annotationsChanged);
  }
}

/** The open windows (injected by the first `PageAnnotator`, not imported: no cycle with `window.ts`). */
let windows: Pick<WindowDirectory, "all"> | null = null;
/** The annotator of each window. */
const annotators = new WeakMap<WindowPort, PageAnnotator>();

/** Sync applies remote changes through this (ADR-019): same path as the UI. */
export function setProfileAnnotations(next: AnnotationsData): void {
  profileBook.save(next);
}

const PRIVATE_NOTICE = (): string => t("annotationsIndex.privateWindowTheseNotes");
const NO_SELECTION = (): string => t("annotationsIndex.selectTextPageHighlight");

/** The color of the next highlight made without choosing one (the shortcut): the last one chosen. */
let lastColor: HighlightColor = "yellow";

export class PageAnnotator {
  private memory: MemoryBook | null = null;
  /** Highlights not found on each tab's page, from the last drawing. */
  private readonly missing = new Map<TabId, string[]>();
  /** Pages whose current document was given highlights (so a removal clears them). */
  private readonly drawn = new WeakSet<WebContents>();

  constructor(
    private readonly c: WindowPort,
    directory: Pick<WindowDirectory, "all">,
  ) {
    windows = directory;
    annotators.set(c, this);
  }

  /** Read lazily: the window's privacy is not known yet when this is built. */
  get book(): AnnotationBook {
    return this.c.isPrivate ? (this.memory ??= new MemoryBook()) : profileBook;
  }

  private page(tabId: TabId): { contents: WebContents; url: string; title: string } | null {
    const entry = this.c.spaces.allTabs().find((item) => item.tab.id === tabId);
    const contents = entry?.manager.pageOf(tabId);
    const url = contents && !contents.isDestroyed() ? annotationUrl(contents.getURL()) : null;
    return contents && url ? { contents, url, title: entry?.tab.title ?? "" } : null;
  }

  // --- Drawing -------------------------------------------------------------------------------

  /** A new document is ready (dom-ready): its highlights, if it has any. */
  pageReady(tabId: TabId, contents: WebContents): void {
    documentChanged(contents);
    this.drawn.delete(contents);
    this.missing.delete(tabId);
    void this.draw(tabId, contents);
  }

  private async draw(tabId: TabId, contents: WebContents): Promise<void> {
    const url = annotationUrl(contents.getURL());
    const marks = url ? highlightsFor(this.book.data, url).map(markOf) : [];
    // Nothing to show and nothing shown: the page is left alone (no script, no CSS).
    if (!marks.length && !this.drawn.has(contents)) return;
    this.drawn.add(contents);
    const status = await applyMarks(contents, marks);
    const before = this.missing.get(tabId)?.join();
    if (status) this.missing.set(tabId, status.missing);
    if (before !== this.missing.get(tabId)?.join()) this.c.send(Channels.annotationsChanged);
  }

  /** Redraws every live page of the window (after a change). */
  refreshAll(): void {
    for (const { manager, tab } of this.c.spaces.allTabs()) {
      const contents = manager.pageOf(tab.id);
      if (contents && !contents.isDestroyed()) void this.draw(tab.id, contents);
    }
  }

  // --- Making and changing -------------------------------------------------------------------

  /** "Surligner" (page menu, shortcut, notes panel): the tab's selection becomes a highlight. */
  async highlightSelection(tabId: TabId, color: HighlightColor = lastColor): Promise<AnnotationResult> {
    const page = this.page(tabId);
    if (!page) return { ok: false, message: t("annotationsIndex.pageCantAnnotated") };
    const captured = await captureSelection(page.contents);
    if (!captured) return { ok: false, message: NO_SELECTION() };
    const id = randomUUID();
    const next = addHighlight(this.book.data, { id, url: page.url, title: page.title, quote: captured.quote, color, now: Date.now() });
    if (!next) return { ok: false, message: t("annotationsIndex.tooManyHighlightsDelete") };
    lastColor = color;
    this.book.save(next);
    // The selection is drawn now: deselect so the highlight shows.
    void page.contents.executeJavaScript("window.getSelection() && window.getSelection().removeAllRanges()").catch(() => {});
    return { ok: true, id };
  }

  get(id: string): Highlight | null {
    return this.book.data.highlights.find((highlight) => highlight.id === id) ?? null;
  }

  update(id: string, patch: HighlightPatch): Highlight | null {
    if (!this.get(id)) return null;
    if (patch.color) lastColor = patch.color;
    this.book.save(updateHighlight(this.book.data, id, patch, Date.now()));
    return this.get(id);
  }

  remove(id: string): void {
    if (this.get(id)) this.book.save(removeHighlight(this.book.data, id));
  }

  /** A page's note (empty text removes it). */
  setNote(url: string, text: string, title?: string): void {
    const key = annotationUrl(url);
    if (!key) return;
    const known = title ?? noteFor(this.book.data, key)?.title ?? highlightsFor(this.book.data, key)[0]?.title ?? "";
    this.book.save(setPageNote(this.book.data, key, known, text, Date.now()));
  }

  removePage(url: string): void {
    this.book.save(removePage(this.book.data, url));
  }

  copy(id: string): void {
    const highlight = this.get(id);
    if (highlight) clipboard.writeText(highlight.exact);
  }

  // --- Reading -------------------------------------------------------------------------------

  forTab(tabId: TabId): TabAnnotations | null {
    const page = this.page(tabId);
    if (!page) return null;
    return {
      url: page.url,
      title: page.title,
      highlights: highlightsFor(this.book.data, page.url),
      note: noteFor(this.book.data, page.url)?.text ?? "",
      missing: this.missing.get(tabId) ?? [],
      isPrivate: this.book.isPrivate,
      notice: this.book.isPrivate ? PRIVATE_NOTICE() : null,
    };
  }

  list(): AnnotationsList {
    return { ...this.book.data, isPrivate: this.book.isPrivate, notice: this.book.isPrivate ? PRIVATE_NOTICE() : null };
  }

  /** Scrolls the tab's page to a highlight and flashes it. */
  jump(tabId: TabId, id: string): Promise<boolean> {
    const page = this.page(tabId);
    return page ? scrollToMark(page.contents, id) : Promise.resolve(false);
  }

  // --- The popover ---------------------------------------------------------------------------

  /** A click on a highlight of a tab's page: its popover, under the highlight. */
  clicked(tabId: TabId, click: MarkClick): void {
    const page = this.page(tabId);
    const highlight = this.get(click.id);
    if (!page || highlight?.url !== page.url) return;
    if (this.c.tabs.activeTabId !== tabId) this.c.tabs.activate(tabId);
    const view = this.c.tabs.viewBounds;
    const zoom = page.contents.getZoomFactor();
    const [x, y, width, height] = click.rect;
    this.c.overlay.open({
      kind: "annotation",
      tabId,
      annotationId: click.id,
      anchor: { x: view.x + x * zoom, y: view.y + y * zoom, width: width * zoom, height: height * zoom },
    });
  }

  // --- Export --------------------------------------------------------------------------------

  async exportAs(format: AnnotationExportFormat): Promise<AnnotationResult | null> {
    const markdown = format === "markdown";
    const { canceled, filePath } = await dialog.showSaveDialog(this.c.window, {
      title: t("annotationsIndex.exportNotes"),
      defaultPath: markdown ? "notes.md" : "notes.json",
      filters: markdown ? [{ name: "Markdown", extensions: ["md"] }] : [{ name: "JSON", extensions: ["json"] }],
    });
    if (canceled || !filePath) return null;
    try {
      await writeFile(filePath, markdown ? annotationsToMarkdown(this.book.data) : annotationsToJson(this.book.data), "utf8");
      return { ok: true, id: "" };
    } catch {
      return { ok: false, message: t("annotationsIndex.exportFailed") };
    }
  }
}
