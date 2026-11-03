import { isExportFormat } from "@shared/annotations/export";
import { ANNOTATION_LIMITS, isAnnotationId, isHighlightColor, sanitizeHighlightPatch, type HighlightPatch } from "@shared/annotations/model";
import { Channels } from "@shared/ipc";
import { custom, defineHandlers, handle, maxStr, on, opt, str } from "./registry";

/**
 * Notes and highlights (ADR-037): each window acts on its own book (the profile's, or its private
 * one); highlights are named by id, pages by URL (main keeps http(s) pages only), tabs of the
 * sender's window by id. Quotes are never sent by the UIs: main reads them from the page.
 */
const id = isAnnotationId;
const patch = custom<HighlightPatch>((value) => sanitizeHighlightPatch(value) !== null);
const url = maxStr(ANNOTATION_LIMITS.url);

export const annotationHandlers = defineHandlers({
  [Channels.annotationsForTab]: handle([str], (c, tabId) => c.annotator.forTab(tabId)),
  [Channels.annotationsList]: handle([], (c) => c.annotator.list()),
  [Channels.annotationsGet]: handle([id], (c, highlightId) => c.annotator.get(highlightId)),
  [Channels.annotationsHighlight]: handle([str, opt(isHighlightColor)], (c, tabId, color) =>
    c.annotator.highlightSelection(tabId, color ?? undefined),
  ),
  [Channels.annotationsUpdate]: handle([id, patch], (c, highlightId, change) => c.annotator.update(highlightId, sanitizeHighlightPatch(change)!)),
  [Channels.annotationsRemove]: on([id], (c, highlightId) => c.annotator.remove(highlightId)),
  [Channels.annotationsSetNote]: on([url, maxStr(ANNOTATION_LIMITS.pageNote)], (c, page, text) => c.annotator.setNote(page, text)),
  [Channels.annotationsRemovePage]: on([url], (c, page) => c.annotator.removePage(page)),
  [Channels.annotationsJump]: handle([str, id], (c, tabId, highlightId) => c.annotator.jump(tabId, highlightId)),
  [Channels.annotationsCopy]: on([id], (c, highlightId) => c.annotator.copy(highlightId)),
  [Channels.annotationsExport]: handle([isExportFormat], (c, format) => c.annotator.exportAs(format)),
});
