import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, fromBase64Url, randomBytesChecked, toBase64Url, toHex, utf8Decode, utf8Encode, type RandomBytes } from "./bytes";

/**
 * End-to-end encryption of sync records (ADR-019). Everything here runs on the devices; the server
 * only ever stores the opaque envelopes and record ids produced below.
 *
 * - One random 256-bit sync key per account, shared by pairing (QR code / pairing code).
 * - HKDF-SHA256 derives independent subkeys: one encrypts, one hashes record ids.
 * - Records: XChaCha20-Poly1305 with a random 192-bit nonce (safe with random nonces), associated
 *   data binding the ciphertext to its collection and record id (no swapping records around).
 * - Record ids: HMAC-SHA256(idKey, collection + local id), truncated to 128 bits, so a URL used as a
 *   local id (history, bookmarks) never reaches the server, not even hashed without a key.
 */

export const SYNC_KEY_BYTES = 32;
const NONCE_BYTES = 24;
const ENVELOPE_VERSION = 1;
const KDF_SALT = utf8Encode("browser-sync/v1");

export interface SyncKeys {
  /** Encrypts and authenticates record payloads. */
  enc: Uint8Array;
  /** Keyed hash of record ids. */
  id: Uint8Array;
  /** Seals the local mirror of sensitive collections at rest (ADR-050); never leaves the device. */
  local: Uint8Array;
  /** Short fingerprint of the sync key, to tell keys apart in the UI and in tests (not secret-bearing). */
  fingerprint: string;
}

export function generateSyncKey(rng: RandomBytes): Uint8Array {
  return randomBytesChecked(rng, SYNC_KEY_BYTES);
}

export function deriveKeys(syncKey: Uint8Array): SyncKeys {
  if (syncKey.length !== SYNC_KEY_BYTES) throw new Error("Sync key must be 32 bytes");
  const derive = (info: string) => hkdf(sha256, syncKey, KDF_SALT, utf8Encode(info), 32);
  return {
    enc: derive("record-encryption"),
    id: derive("record-id"),
    local: derive("local-state"),
    fingerprint: toHex(derive("fingerprint").subarray(0, 4)),
  };
}

/** Collection names are short lowercase words (also checked by the server). */
export const isCollectionName = (value: unknown): value is string => typeof value === "string" && /^[a-z]{1,32}$/.test(value);
/** Server-side record ids: 32 lowercase hex characters. */
export const isRecordId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{32}$/.test(value);

/** Opaque, stable id of a local record (keyed: the server cannot test guesses like "https://bank…"). */
export function recordId(keys: SyncKeys, collection: string, localId: string): string {
  return toHex(hmac(sha256, keys.id, utf8Encode(`${collection}\u0000${localId}`)).subarray(0, 16));
}

function associatedData(collection: string, rid: string): Uint8Array {
  return utf8Encode(`browser-sync/v1|${collection}|${rid}`);
}

function sealWith(key: Uint8Array, rng: RandomBytes, ad: Uint8Array, plaintext: string): string {
  const nonce = randomBytesChecked(rng, NONCE_BYTES);
  const sealed = xchacha20poly1305(key, nonce, ad).encrypt(utf8Encode(plaintext));
  return toBase64Url(concatBytes(Uint8Array.of(ENVELOPE_VERSION), nonce, sealed));
}

function openWith(key: Uint8Array, ad: Uint8Array, envelope: string): string {
  const bytes = fromBase64Url(envelope);
  if (bytes.length < 1 + NONCE_BYTES + 16 || bytes[0] !== ENVELOPE_VERSION) throw new Error("Unsupported envelope");
  const nonce = bytes.subarray(1, 1 + NONCE_BYTES);
  return utf8Decode(xchacha20poly1305(key, nonce, ad).decrypt(bytes.subarray(1 + NONCE_BYTES)));
}

/** Encrypts a record's plaintext into a base64url envelope: version byte, nonce, ciphertext + tag. */
export function seal(keys: SyncKeys, rng: RandomBytes, collection: string, rid: string, plaintext: string): string {
  return sealWith(keys.enc, rng, associatedData(collection, rid), plaintext);
}

/** Decrypts an envelope made by `seal` for the same collection and record id; throws if anything was altered. */
export function open(keys: SyncKeys, collection: string, rid: string, envelope: string): string {
  return openWith(keys.enc, associatedData(collection, rid), envelope);
}

const localData = (collection: string) => utf8Encode(`browser-sync/v1|local|${collection}`);

/** Seals a sensitive collection's local mirror (ADR-050): the key derives from the sync key, kept in the OS keychain. */
export const sealLocal = (keys: SyncKeys, rng: RandomBytes, collection: string, plaintext: string): string => sealWith(keys.local, rng, localData(collection), plaintext);
export const openLocal = (keys: SyncKeys, collection: string, envelope: string): string => openWith(keys.local, localData(collection), envelope);
