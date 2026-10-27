/**
 * Byte helpers for the sync engine, written in plain JS so they behave the same in Electron's main
 * process, Node (server tests) and Hermes (no `atob`/`TextDecoder` guarantees there).
 */

/** Random bytes source, injected by each platform (Node `crypto.randomBytes`, `expo-crypto`). */
export type RandomBytes = (length: number) => Uint8Array;

export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    // Surrogate pair → one code point; a lone surrogate becomes U+FFFD.
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      } else code = 0xfffd;
    } else if (code >= 0xdc00 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return Uint8Array.from(out);
}

/** Strict UTF-8 decoding: malformed input throws (ciphertext is authenticated, garbage is a bug). */
export function utf8Decode(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let code: number;
    let extra: number;
    if (b < 0x80) (code = b), (extra = 0);
    else if (b >= 0xc2 && b < 0xe0) (code = b & 31), (extra = 1);
    else if (b >= 0xe0 && b < 0xf0) (code = b & 15), (extra = 2);
    else if (b >= 0xf0 && b < 0xf5) (code = b & 7), (extra = 3);
    else throw new Error("Invalid UTF-8");
    if (i + extra >= bytes.length + (extra ? 0 : 1)) throw new Error("Invalid UTF-8");
    for (let k = 1; k <= extra; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) throw new Error("Invalid UTF-8");
      code = (code << 6) | (c & 63);
    }
    if ((extra === 2 && code < 0x800) || (extra === 3 && (code < 0x10000 || code > 0x10ffff))) throw new Error("Invalid UTF-8");
    if (code >= 0xd800 && code <= 0xdfff) throw new Error("Invalid UTF-8");
    i += extra + 1;
    if (code >= 0x10000) {
      code -= 0x10000;
      text += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 1023));
    } else text += String.fromCharCode(code);
  }
  return text;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64_INDEX = new Map([...B64].map((char, index) => [char, index]));

/** RFC 4648 §5 base64url, without padding. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out;
}

/** Decodes base64url (padding tolerated); throws on any other character. */
export function fromBase64Url(text: string): Uint8Array {
  const clean = text.replace(/=+$/, "");
  if (clean.length % 4 === 1) throw new Error("Invalid base64url");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of clean) {
    const digit = B64_INDEX.get(char);
    if (digit === undefined) throw new Error("Invalid base64url");
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (value >> bits) & 255;
    }
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Constant-time comparison (for MACs and secrets). */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Random bytes from the injected source, checked: a broken RNG must never produce keys or nonces. */
export function randomBytesChecked(rng: RandomBytes, length: number): Uint8Array {
  const raw = rng(length);
  if (!ArrayBuffer.isView(raw) || raw.byteLength !== length) throw new Error("Random source returned a wrong length");
  // Copied into this realm's Uint8Array (Node Buffers and test sandboxes use other constructors).
  const bytes = Uint8Array.from(raw);
  // All-zero output of 16+ bytes means a stub or a failed native call, not chance.
  if (length >= 16 && bytes.every((byte) => byte === 0)) throw new Error("Random source returned zeros");
  return bytes;
}
