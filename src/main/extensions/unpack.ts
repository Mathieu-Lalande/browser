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

const MAX_ENTRIES = 5000;
const MAX_TOTAL_SIZE = 200 * 1024 * 1024;

/** The ZIP inside a `.crx` (CRX2 or CRX3); a buffer that already is a ZIP is returned as is. */
export function crxToZip(data: Buffer): Buffer {
  if (data.length >= 4 && data.readUInt32LE(0) === 0x04034b50) return data;
  if (data.length < 12 || data.toString("latin1", 0, 4) !== "Cr24") throw new UnpackError("Ce fichier n'est ni une archive .zip ni une extension .crx.");
  const version = data.readUInt32LE(4);
  let start: number;
  if (version === 3) start = 12 + data.readUInt32LE(8);
  else if (version === 2 && data.length >= 16) start = 16 + data.readUInt32LE(8) + data.readUInt32LE(12);
  else throw new UnpackError(`Format .crx version ${version} non pris en charge.`);
  if (start >= data.length) throw new UnpackError("Le fichier .crx est tronqué.");
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
  throw new UnpackError("L'archive est illisible (fin de répertoire ZIP introuvable).");
}

/** Every file of a ZIP (directories skipped), checked and decompressed. */
export function readZip(zip: Buffer): ZipEntry[] {
  const fail = (detail: string): never => {
    throw new UnpackError(`L'archive est illisible : ${detail}.`);
  };
  const eocd = endOfCentralDirectory(zip);
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) fail("trop de fichiers");
  const entries: ZipEntry[] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== 0x02014b50) fail("répertoire ZIP corrompu");
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const compressedSize = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const next = at + 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    const localOffset = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength).replace(/^\.\//, "");
    at = next;
    if (name.endsWith("/")) continue;
    if (flags & 1) fail("fichiers chiffrés");
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) fail("format ZIP64 non pris en charge");
    if (!isSafeRelativePath(name)) fail(`chemin refusé « ${name.slice(0, 80)} »`);
    total += size;
    if (total > MAX_TOTAL_SIZE) fail("contenu trop volumineux");
    if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== 0x04034b50) fail("entrée ZIP corrompue");
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const raw = zip.subarray(dataStart, dataStart + compressedSize);
    if (raw.length !== compressedSize) fail("archive tronquée");
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      try {
        data = inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
      } catch {
        return fail("données compressées invalides");
      }
    } else return fail(`méthode de compression ${method} non prise en charge`);
    if (data.length !== size || crc32(data) !== crc) fail(`contrôle d'intégrité échoué pour « ${name.slice(0, 80)} »`);
    entries.push({ path: name, data });
  }
  return entries;
}

/**
 * Writes a packed extension (.zip or .crx) into `target` (which must not exist yet). An archive
 * whose files all sit in one top-level folder (common for downloaded sources) is unpacked from it.
 */
export function unpackExtension(file: Buffer, target: string): void {
  let entries = readZip(crxToZip(file));
  if (!entries.some((entry) => entry.path === "manifest.json")) {
    const top = entries[0]?.path.split("/")[0];
    const prefix = `${top}/`;
    if (top && entries.every((entry) => entry.path.startsWith(prefix)) && entries.some((entry) => entry.path === `${prefix}manifest.json`)) {
      entries = entries.map((entry) => ({ path: entry.path.slice(prefix.length), data: entry.data }));
    } else {
      throw new UnpackError("L'archive ne contient pas de fichier manifest.json.");
    }
  }
  const root = resolve(target);
  mkdirSync(root, { recursive: true });
  for (const entry of entries) {
    const destination = resolve(join(root, entry.path));
    if (!destination.startsWith(root + sep)) throw new UnpackError("L'archive contient un chemin refusé.");
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, entry.data);
  }
}
