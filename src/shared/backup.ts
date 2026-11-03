import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { scrypt } from "@noble/hashes/scrypt.js";
import { fromBase64Url, randomBytesChecked, toBase64Url, utf8Decode, utf8Encode, type RandomBytes } from "./sync/bytes";

/**
 * Profile backup (`.browserbackup`, ADR-042): one JSON file with the profile's settings, bookmarks,
 * favorites, history, session, boosts, notes and archive. Passwords only when asked for, then
 * encrypted with a passphrase (scrypt + XChaCha20-Poly1305, the `@noble` primitives of sync).
 * Never any cookie nor site data. Pure: main collects and applies the sections.
 */

export const BACKUP_FORMAT = "browser-backup";
export const BACKUP_VERSION = 1;
export const BACKUP_EXTENSION = "browserbackup";
/** Larger files are refused before parsing. */
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
export const MIN_PASSPHRASE = 8;

/** The plain sections; each is validated by its own store's parser on import. */
export const BACKUP_SECTIONS = ["settings", "bookmarks", "favorites", "history", "session", "boosts", "annotations", "archive"] as const;
export type BackupSection = (typeof BACKUP_SECTIONS)[number];

export type BackupContents = Partial<Record<BackupSection, unknown>>;

export interface SealedSecret {
  kdf: "scrypt";
  n: number;
  r: number;
  p: number;
  salt: string;
  nonce: string;
  data: string;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: number;
  profileName: string;
  contents: BackupContents;
  /** The password vault, sealed with the passphrase. */
  passwords?: SealedSecret;
}

/** What the import preview shows. */
export interface BackupSummary {
  createdAt: number;
  profileName: string;
  counts: Partial<Record<BackupSection | "passwords", number>>;
  hasPasswords: boolean;
}

export type BackupMode = "merge" | "replace";
export const isBackupMode = (value: unknown): value is BackupMode => value === "merge" || value === "replace";

export interface KdfParams {
  n: number;
  r: number;
  p: number;
}

/** ~100 ms on a laptop: a passphrase guess costs as much. */
export const DEFAULT_KDF: KdfParams = { n: 2 ** 15, r: 8, p: 1 };
const MAX_KDF_N = 2 ** 20;

function deriveKey(passphrase: string, salt: Uint8Array, params: KdfParams): Uint8Array {
  return scrypt(utf8Encode(passphrase.normalize("NFC")), salt, { N: params.n, r: params.r, p: params.p, dkLen: 32 });
}

const AAD = utf8Encode(`${BACKUP_FORMAT}/v${BACKUP_VERSION}/passwords`);

export function sealSecret(plaintext: string, passphrase: string, rng: RandomBytes, params: KdfParams = DEFAULT_KDF): SealedSecret {
  const salt = randomBytesChecked(rng, 16);
  const nonce = randomBytesChecked(rng, 24);
  const data = xchacha20poly1305(deriveKey(passphrase, salt, params), nonce, AAD).encrypt(utf8Encode(plaintext));
  return { kdf: "scrypt", ...params, salt: toBase64Url(salt), nonce: toBase64Url(nonce), data: toBase64Url(data) };
}

export class WrongPassphraseError extends Error {
  constructor() {
    super("Phrase secrète incorrecte");
  }
}

/** Decrypts a sealed secret; a wrong passphrase (or altered data) throws `WrongPassphraseError`. */
export function openSecret(sealed: SealedSecret, passphrase: string): string {
  try {
    const key = deriveKey(passphrase, fromBase64Url(sealed.salt), sealed);
    return utf8Decode(xchacha20poly1305(key, fromBase64Url(sealed.nonce), AAD).decrypt(fromBase64Url(sealed.data)));
  } catch {
    throw new WrongPassphraseError();
  }
}

function isSealed(value: unknown): value is SealedSecret {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  const int = (v: unknown, max: number) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= max;
  return (
    s.kdf === "scrypt" &&
    int(s.n, MAX_KDF_N) &&
    int(s.r, 32) &&
    int(s.p, 16) &&
    typeof s.salt === "string" &&
    typeof s.nonce === "string" &&
    typeof s.data === "string"
  );
}

export function encodeBackup(input: {
  contents: BackupContents;
  profileName: string;
  createdAt: number;
  passwords?: { vault: unknown; passphrase: string; rng: RandomBytes; kdf?: KdfParams };
}): string {
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: input.createdAt,
    profileName: input.profileName,
    contents: input.contents,
  };
  if (input.passwords) {
    if (input.passwords.passphrase.length < MIN_PASSPHRASE) throw new Error("Passphrase too short");
    file.passwords = sealSecret(JSON.stringify(input.passwords.vault), input.passwords.passphrase, input.passwords.rng, input.passwords.kdf);
  }
  return JSON.stringify(file);
}

/** Parses a backup file; null when it is not one (or comes from a newer version). */
export function decodeBackup(text: string): BackupFile | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.format !== BACKUP_FORMAT || !Number.isInteger(d.version) || (d.version as number) > BACKUP_VERSION) return null;
  if (typeof d.contents !== "object" || d.contents === null) return null;
  const contents: BackupContents = {};
  for (const section of BACKUP_SECTIONS) {
    const value = (d.contents as Record<string, unknown>)[section];
    if (value !== undefined) contents[section] = value;
  }
  return {
    format: BACKUP_FORMAT,
    version: d.version as number,
    createdAt: typeof d.createdAt === "number" ? d.createdAt : 0,
    profileName: typeof d.profileName === "string" ? d.profileName.slice(0, 80) : "",
    contents,
    ...(isSealed(d.passwords) ? { passwords: d.passwords } : {}),
  };
}

/** Rough sizes for the preview: list lengths, or the entries of a known shape. */
function countOf(section: BackupSection, value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value !== "object" || value === null) return 0;
  const v = value as Record<string, unknown>;
  if (section === "bookmarks" && Array.isArray(v.bookmarks)) return v.bookmarks.length;
  if (section === "session" && Array.isArray(v.windows)) return v.windows.length;
  if (section === "annotations" && Array.isArray(v.highlights)) return v.highlights.length + (Array.isArray(v.notes) ? v.notes.length : 0);
  return 1;
}

export function summarizeBackup(file: BackupFile): BackupSummary {
  const counts: BackupSummary["counts"] = {};
  for (const section of BACKUP_SECTIONS) if (file.contents[section] !== undefined) counts[section] = countOf(section, file.contents[section]);
  return { createdAt: file.createdAt, profileName: file.profileName, counts, hasPasswords: !!file.passwords };
}

/** A file name for an export: "Browser-Personnel-2026-11-03.browserbackup". */
export function backupFileName(profileName: string, now: number): string {
  const day = new Date(now).toISOString().slice(0, 10);
  const name = profileName.replace(/[\\/:*?"<>|\u0000-\u001f\s]+/g, "-").replace(/^-+|-+$/g, "") || "profil";
  return `Browser-${name}-${day}.${BACKUP_EXTENSION}`;
}
