import { createHash, createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { crc32 } from "node:zlib";

/**
 * Test helpers (ADR-049): a stored ZIP and a signed CRX3 package, built like the Chrome Web Store's
 * (developer RSA proof, `signed_header_data` naming the id), for unit and end-to-end tests.
 */

/** A ZIP of `files` (stored entries, no compression). */
export function zipOf(files: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const nameBytes = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const varint = (value: number): Buffer => {
  const bytes: number[] = [];
  while (value > 127) {
    bytes.push((value & 127) | 128);
    value = Math.floor(value / 128);
  }
  bytes.push(value);
  return Buffer.from(bytes);
};

const field = (number: number, payload: Buffer) => Buffer.concat([varint(number * 8 + 2), varint(payload.length), payload]);

export interface TestKey {
  privateKey: KeyObject;
  /** DER SubjectPublicKeyInfo. */
  publicKey: Buffer;
  /** Chrome's id of that key. */
  id: string;
}

export function testKey(): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const der = publicKey.export({ format: "der", type: "spki" });
  const hash = createHash("sha256").update(der).digest();
  const id = [...hash.subarray(0, 16)].map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join("");
  return { privateKey, publicKey: der, id };
}

/**
 * A CRX3 of `zip` signed by `key`. `claimedId`: the id written in the signed header (default:
 * the key's). `tamper`: the ZIP is changed after signing.
 */
export function crx3(zip: Buffer, key: TestKey, options: { claimedId?: string; tamper?: boolean } = {}): Buffer {
  const claimed = options.claimedId ?? key.id;
  const crxId = Buffer.from([...Array(16)].map((_, i) => ((claimed.charCodeAt(2 * i) - 97) << 4) | (claimed.charCodeAt(2 * i + 1) - 97)));
  const signedHeaderData = field(1, crxId);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(signedHeaderData.length);
  const signer = createSign("sha256");
  for (const part of [Buffer.from("CRX3 SignedData\x00", "latin1"), length, signedHeaderData, zip]) signer.update(part);
  const signature = signer.sign(key.privateKey);
  const header = Buffer.concat([field(2, Buffer.concat([field(1, key.publicKey), field(2, signature)])), field(10000, signedHeaderData)]);
  const prefix = Buffer.alloc(12);
  prefix.write("Cr24", 0, "latin1");
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);
  const body = options.tamper ? Buffer.concat([zip, Buffer.from("x")]) : zip;
  return Buffer.concat([prefix, header, body]);
}
