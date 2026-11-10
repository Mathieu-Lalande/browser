/**
 * Downloads that continue after a restart (ADR-054), pure: what is kept of an unfinished download
 * (redirect chain, validators), its validation when read back, and whether "Reprendre" can continue
 * from the partial file (`session.createInterruptedDownload`) or must start over.
 */
import type { DownloadEntry, DownloadResumeState } from "./downloads";

const MAX_CHAIN = 20;
const MAX_URL = 8192;
const MAX_VALIDATOR = 1024;

const isWebUrl = (value: unknown): value is string => typeof value === "string" && value.length <= MAX_URL && /^https?:\/\//i.test(value);
const validator = (value: unknown) => (typeof value === "string" && value.length <= MAX_VALIDATOR ? value : "");

/** A stored resume state, validated (http(s) chain, bounded strings), or undefined. */
export function sanitizeResume(value: unknown): DownloadResumeState | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const r = value as Record<string, unknown>;
  const chain = Array.isArray(r.urlChain) ? r.urlChain.slice(0, MAX_CHAIN) : [];
  if (!chain.length || !chain.every(isWebUrl)) return undefined;
  const etag = validator(r.etag);
  const lastModified = validator(r.lastModified);
  if (!etag && !lastModified) return undefined;
  const startTime = typeof r.startTime === "number" && Number.isFinite(r.startTime) && r.startTime > 0 ? r.startTime : 0;
  return { urlChain: chain, etag, lastModified, startTime };
}

/** What Electron's DownloadItem says about its response (`getURLChain`, `getETag`…). */
export interface ResumeSource {
  urlChain: string[];
  etag: string;
  lastModified: string;
  startTime: number;
}

/**
 * The resume state of a running download, or undefined when it could not continue after a restart:
 * without `ETag` or `Last-Modified` a server cannot confirm the partial file is still the same file
 * (Chromium refuses to resume then), and only web downloads are kept.
 */
export function resumeStateOf(source: ResumeSource): DownloadResumeState | undefined {
  return sanitizeResume(source);
}

export const sameResumeState = (a: DownloadResumeState | undefined, b: DownloadResumeState | undefined): boolean =>
  a === b || (!!a && !!b && a.etag === b.etag && a.lastModified === b.lastModified && a.startTime === b.startTime && a.urlChain.join("\n") === b.urlChain.join("\n"));

/** The options of `session.createInterruptedDownload`. */
export interface InterruptedDownloadRequest {
  path: string;
  urlChain: string[];
  mimeType: string;
  offset: number;
  length: number;
  lastModified: string;
  eTag: string;
  startTime: number;
}

/**
 * How "Reprendre"/"Réessayer" continues a download from a previous run: from the partial file
 * (`fileSize` bytes on disk) when everything needed was kept, or null to start over from the URL
 * (nothing on disk, no validator, a dangerous file, a file larger than announced…). The server may
 * still refuse the range: Chromium then starts over by itself.
 */
export function resumePlan(entry: DownloadEntry, fileSize: number | null): InterruptedDownloadRequest | null {
  const resume = entry.resume;
  if (!resume || entry.state !== "interrupted" || entry.dangerous || entry.awaitingConfirmation || !entry.path) return null;
  if (fileSize === null || !Number.isFinite(fileSize) || fileSize <= 0) return null;
  if (entry.totalBytes > 0 && fileSize >= entry.totalBytes) return null;
  if (!sanitizeResume(resume)) return null;
  return {
    path: entry.path,
    urlChain: [...resume.urlChain],
    mimeType: entry.mimeType,
    offset: Math.floor(fileSize),
    length: entry.totalBytes,
    lastModified: resume.lastModified,
    eTag: resume.etag,
    startTime: resume.startTime,
  };
}

/** The entry as the UI gets it: without the resume state (redirects, validators stay in main). */
export function publicEntry(entry: DownloadEntry): DownloadEntry {
  if (!entry.resume) return { ...entry };
  const { resume: _resume, ...rest } = entry;
  return rest;
}
