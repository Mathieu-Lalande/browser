import { t } from "@shared/i18n";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";
import { isSafeRelativePath } from "@shared/extensions";

/**
 * Packed extensions (ADR-024): a `.crx` is a ZIP behind a small header (CRX3: "Cr24", version,
 * header size, signed header; CRX2: "Cr24", version, key and signature sizes). The ZIP reader is
 * deliberately small: stored and deflated entries only, no ZIP64, no encryption, bounded sizes,
 * and every path checked so nothing is written outside the target folder. Signatures are not
 * verified: the user picked the file, like "load unpacked" in Chrome.
 */

export class UnpackError extends Error {}

/**
 * Limits of a packed extension. Real extensions ship many small files (Wappalyzer: thousands of
 * icons), so the count is generous; zip bombs are stopped by the total and per-file sizes and by
 * the compression ratio, all checked from the central directory before anything is inflated, and
 * again while inflating (`maxOutputLength`).
 */
export const ZIP_LIMITS = {
  entries: 50_000,
  totalSize: 1024 * 1024 * 1024,
  entrySize: 256 * 1024 * 1024,
  /** Uncompressed / compressed, for entries large enough to matter (text compresses ~10:1, zeros ~1000:1). */
  ratio: 200,
  ratioFrom: 1024 * 1024,
} as const;

const MIB = 1024 * 1024;
const count = (value: number) => value.toLocaleString("fr-FR");

/** The ZIP inside a `.crx` (CRX2 or CRX3); a buffer that already is a ZIP is returned as is. */
export function crxToZip(data: Buffer): Buffer {
  if (data.length >= 4 && data.readUInt32LE(0) === 0x04034b50) return data;
  if (data.length < 12 || data.toString("latin1", 0, 4) !== "Cr24") throw new UnpackError(t("extensionsUnpack.fileNeitherZipArchive"));
  const version = data.readUInt32LE(4);
  let start: number;
  if (version === 3) start = 12 + data.readUInt32LE(8);
  else if (version === 2 && data.length >= 16) start = 16 + data.readUInt32LE(8) + data.readUInt32LE(12);
  else throw new UnpackError(t("extensionsUnpack.crxFormatVersionNot", { version }));
  if (start >= data.length) throw new UnpackError(t("extensionsUnpack.crxFileTruncated"));
  return data.subarray(start);
}

export interface ZipEntry {
  /** Relative path, `/`-separated, without a leading `./`. */
  path: string;
  data: Buffer;
}

function endOfCentralDirectory(zip: Buffer): number {
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at--) {
    if (zip.readUInt32LE(at) === 0x06054b50) return at;
  }
  throw new UnpackError(t("extensionsUnpack.archiveUnreadableEndZip"));
}

interface CentralEntry {
  path: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

const fail = (detail: string): never => {
  throw new UnpackError(t("extensionsUnpack.archiveUnreadable", { detail }));
};

/** The files listed by the central directory (directories skipped), every limit checked, nothing inflated. */
function centralDirectory(zip: Buffer): CentralEntry[] {
  const eocd = endOfCentralDirectory(zip);
  const total = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  if (total === 0xffff || at === 0xffffffff) fail(t("extensionsUnpack.zip64FormatNotSupported"));
  if (total > ZIP_LIMITS.entries) {
    throw new UnpackError(t("extensionsUnpack.archiveContainsTooMany", { p: count(total), p2: count(ZIP_LIMITS.entries) }));
  }
  const entries: CentralEntry[] = [];
  let size = 0;
  for (let i = 0; i < total; i++) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== 0x02014b50) fail(t("extensionsUnpack.corruptZipDirectory"));
    const flags = zip.readUInt16LE(at + 8);
    const nameLength = zip.readUInt16LE(at + 28);
    const entry: CentralEntry = {
      path: zip.toString("utf8", at + 46, at + 46 + nameLength).replace(/^\.\//, ""),
      method: zip.readUInt16LE(at + 10),
      crc: zip.readUInt32LE(at + 16),
      compressedSize: zip.readUInt32LE(at + 20),
      size: zip.readUInt32LE(at + 24),
      localOffset: zip.readUInt32LE(at + 42),
    };
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    if (entry.path.endsWith("/")) continue;
    const name = t("extensionsUnpack.text", { p: entry.path.slice(0, 80) });
    if (flags & 1) fail(t("extensionsUnpack.encryptedFile", { name }));
    if (entry.compressedSize === 0xffffffff || entry.size === 0xffffffff || entry.localOffset === 0xffffffff) fail(t("extensionsUnpack.zip64FormatNotSupported"));
    if (!isSafeRelativePath(entry.path)) fail(t("extensionsUnpack.refusedPath", { name }));
    if (entry.method !== 0 && entry.method !== 8) fail(t("extensionsUnpack.compressionMethodNotSupported", { method: entry.method, name }));
    if (entry.size > ZIP_LIMITS.entrySize) {
      throw new UnpackError(t("extensionsUnpack.archiveContainsFileThat", { name, p: Math.round(entry.size / MIB), p2: ZIP_LIMITS.entrySize / MIB }));
    }
    if (entry.method === 8 && entry.size >= ZIP_LIMITS.ratioFrom && entry.size > entry.compressedSize * ZIP_LIMITS.ratio) {
      throw new UnpackError(t("extensionsUnpack.archiveRefusedFileAbnormally", { name }));
    }
    size += entry.size;
    if (size > ZIP_LIMITS.totalSize) {
      throw new UnpackError(t("extensionsUnpack.archiveTooLargeOnce", { p: ZIP_LIMITS.totalSize / MIB / 1024 }));
    }
    entries.push(entry);
  }
  return entries;
}

/** One file's data, inflated and checked against its CRC. */
function inflateEntry(zip: Buffer, entry: CentralEntry): Buffer {
  const name = t("extensionsUnpack.text", { p: entry.path.slice(0, 80) });
  const { localOffset } = entry;
  if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== 0x04034b50) fail(t("extensionsUnpack.corruptZipEntry", { name }));
  const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
  const raw = zip.subarray(dataStart, dataStart + entry.compressedSize);
  if (raw.length !== entry.compressedSize) fail(t("extensionsUnpack.truncatedArchive"));
  let data: Buffer;
  if (entry.method === 0) data = Buffer.from(raw);
  else {
    try {
      data = inflateRawSync(raw, { maxOutputLength: Math.max(entry.size, 1) });
    } catch {
      return fail(t("extensionsUnpack.invalidCompressedData", { name }));
    }
  }
  if (data.length !== entry.size || crc32(data) !== entry.crc) fail(t("extensionsUnpack.integrityCheckFailed", { name }));
  return data;
}

/** Every file of a ZIP (directories skipped), checked and decompressed. */
export function readZip(zip: Buffer): ZipEntry[] {
  return centralDirectory(zip).map((entry) => ({ path: entry.path, data: inflateEntry(zip, entry) }));
}

/**
 * Writes a packed extension (.zip or .crx) into `target` (which must not exist yet). An archive
 * whose files all sit in one top-level folder (common for downloaded sources) is unpacked from it.
 */
export function unpackExtension(file: Buffer, target: string): void {
  const zip = crxToZip(file);
  const entries = centralDirectory(zip);
  let prefix = "";
  if (!entries.some((entry) => entry.path === "manifest.json")) {
    const top = entries[0]?.path.split("/")[0];
    if (top && entries.every((entry) => entry.path.startsWith(`${top}/`)) && entries.some((entry) => entry.path === `${top}/manifest.json`)) {
      prefix = `${top}/`;
    } else {
      throw new UnpackError(t("extensionsUnpack.archiveHasNoManifest"));
    }
  }
  const root = resolve(target);
  mkdirSync(root, { recursive: true });
  // One file in memory at a time: a large extension never sits whole in memory once inflated.
  for (const entry of entries) {
    const destination = resolve(join(root, entry.path.slice(prefix.length)));
    if (!destination.startsWith(root + sep)) throw new UnpackError(t("extensionsUnpack.archiveContainsRefusedPath"));
    const data = inflateEntry(zip, entry);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, data);
  }
}
