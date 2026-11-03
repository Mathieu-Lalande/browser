import { sanitizeHighlight, sanitizePageNote, type AnnotationsData, type Highlight, type PageNote } from "./model";

/**
 * The `annotations` sync collection (ADR-019, ADR-037), opt-in: one record per highlight
 * (`h:<id>`) and per page note (`n:<url>`), end-to-end encrypted like every record. Conflicts are
 * per record, last writer wins (the engine's rule).
 */

export type SyncedAnnotation = ({ kind: "highlight" } & Omit<Highlight, "id">) | ({ kind: "note" } & PageNote);

export const highlightLocalId = (id: string) => `h:${id}`;
export const noteLocalId = (url: string) => `n:${url}`;

export function annotationRecords(data: AnnotationsData): Map<string, SyncedAnnotation> {
  const records = new Map<string, SyncedAnnotation>();
  for (const { id, ...rest } of data.highlights) records.set(highlightLocalId(id), { kind: "highlight", ...rest });
  for (const note of data.notes) records.set(noteLocalId(note.url), { kind: "note", ...note });
  return records;
}

export function sanitizeSyncedAnnotation(value: unknown, localId: string): SyncedAnnotation | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as { kind?: unknown };
  if (record.kind === "highlight" && localId.startsWith("h:")) {
    const highlight = sanitizeHighlight({ ...value, id: localId.slice(2) });
    if (!highlight) return null;
    const { id: _id, ...rest } = highlight;
    return { kind: "highlight", ...rest };
  }
  if (record.kind === "note" && localId.startsWith("n:")) {
    const note = sanitizePageNote(value);
    return note && noteLocalId(note.url) === localId ? { kind: "note", ...note } : null;
  }
  return null;
}

/** Applies changes from other devices. */
export function mergeAnnotations(local: AnnotationsData, upserts: readonly { id: string; data: SyncedAnnotation }[], deletes: readonly string[]): AnnotationsData {
  const gone = new Set(deletes);
  const highlights = new Map(local.highlights.filter((item) => !gone.has(highlightLocalId(item.id))).map((item) => [item.id, item]));
  const notes = new Map(local.notes.filter((note) => !gone.has(noteLocalId(note.url))).map((note) => [note.url, note]));
  for (const { id, data } of upserts) {
    if (data.kind === "highlight") {
      const { kind: _kind, ...rest } = data;
      const highlight = sanitizeHighlight({ ...rest, id: id.slice(2) });
      if (highlight) highlights.set(highlight.id, highlight);
    } else {
      const { kind: _kind, ...rest } = data;
      const note = sanitizePageNote(rest);
      if (note) notes.set(note.url, note);
    }
  }
  return { highlights: [...highlights.values()], notes: [...notes.values()] };
}
