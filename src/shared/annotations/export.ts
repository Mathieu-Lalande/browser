import { ANNOTATIONS_VERSION, COLOR_LABELS, annotatedSites, type AnnotationFilter, type AnnotationsData } from "./model";

/**
 * Exports of `browser://notes` and the phone's notes (ADR-037): Markdown to read or paste
 * elsewhere, JSON to keep everything (same shape as `annotations.json`).
 */

/** Markdown special characters of inline text escaped (quotes stay readable). */
const inline = (text: string) => text.replace(/([\\`*_[\]<>#|])/g, "\\$1").replace(/\s+/g, " ").trim();
/** Multi-line text as a block quote. */
const quoteBlock = (text: string, prefix = "> ") =>
  text
    .split(/\r?\n/)
    .map((line) => `${prefix}${inline(line)}`.trimEnd())
    .join("\n");

const date = (time: number) => new Date(time).toISOString().slice(0, 10);

export function annotationsToMarkdown(data: AnnotationsData, filter: AnnotationFilter = {}, now = Date.now()): string {
  const lines = ["# Notes et surlignages", "", `Exporté le ${date(now)}.`];
  for (const site of annotatedSites(data, filter)) {
    lines.push("", `## ${inline(site.site)}`);
    for (const page of site.pages) {
      lines.push("", `### [${inline(page.title || page.url)}](<${page.url.replace(/>/g, "%3E")}>)`);
      if (page.note) lines.push("", "**Note de la page :**", "", quoteBlock(page.note.text));
      for (const highlight of page.highlights) {
        lines.push("", `${quoteBlock(highlight.exact)}`, "", `— ${COLOR_LABELS[highlight.color]}, ${date(highlight.createdAt)}`);
        if (highlight.note) lines.push("", quoteBlock(highlight.note, "- Note : "));
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

export function annotationsToJson(data: AnnotationsData): string {
  return `${JSON.stringify({ version: ANNOTATIONS_VERSION, highlights: data.highlights, notes: data.notes }, null, 2)}\n`;
}

export const EXPORT_FORMATS = ["markdown", "json"] as const;
export type AnnotationExportFormat = (typeof EXPORT_FORMATS)[number];
export const isExportFormat = (value: unknown): value is AnnotationExportFormat => EXPORT_FORMATS.includes(value as AnnotationExportFormat);
