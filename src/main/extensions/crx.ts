import { createHash, createPublicKey, createVerify } from "node:crypto";
import { UnpackError } from "./unpack";

/**
 * CRX3 packages from the Chrome Web Store (ADR-049). Layout: "Cr24", version 3, header size, a
 * protobuf `CrxFileHeader` (RSA and ECDSA proofs: public key + signature; `signed_header_data`
 * holding the `crx_id`), then the ZIP. Each proof signs "CRX3 SignedData\0" + the signed header
 * data's length (32-bit little-endian) + that data + the ZIP.
 *
 * A store package is accepted only if its `crx_id` is the requested id, one of its keys hashes to
 * that id (Chrome's rule: SHA-256 of the DER public key, first 16 bytes, hex digits 0–f → a–p),
 * and every proof it carries verifies.
 */

export interface VerifiedCrx {
  /** The extension's files. */
  zip: Buffer;
  /** The developer key (DER SubjectPublicKeyInfo) whose hash is the extension id. */
  publicKey: Buffer;
}

interface Proof {
  key: Buffer;
  signature: Buffer;
  algorithm: "rsa" | "ecdsa";
}

const SIGNED_DATA_PREFIX = Buffer.from("CRX3 SignedData\x00", "latin1");
const MAX_HEADER_SIZE = 1024 * 1024;

/** The a–p id of a 16-byte hash prefix (Chrome's encoding). */
export function idFromBytes(bytes: Uint8Array): string {
  return [...bytes.subarray(0, 16)].map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join("");
}

/** Chrome's extension id of a public key (DER SubjectPublicKeyInfo). */
export function extensionIdFromKey(key: Uint8Array): string {
  return idFromBytes(createHash("sha256").update(key).digest());
}

interface Field {
  number: number;
  /** Length-delimited payload (wire type 2); other types are skipped. */
  bytes: Buffer | null;
}

/** The top-level fields of a protobuf message (only what CRX headers use). */
function readFields(message: Buffer): Field[] {
  const fail = (): never => {
    throw new UnpackError("L'en-tête du fichier .crx est illisible.");
  };
  const fields: Field[] = [];
  let at = 0;
  const varint = (): number => {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      if (at >= message.length) return fail();
      const byte = message[at++];
      value += (byte & 0x7f) * 2 ** shift;
      if (!(byte & 0x80)) return value;
    }
    return fail();
  };
  while (at < message.length) {
    const tag = varint();
    const wire = tag % 8;
    const number = Math.floor(tag / 8);
    if (wire === 0) varint();
    else if (wire === 1) at += 8;
    else if (wire === 5) at += 4;
    else if (wire === 2) {
      const length = varint();
      if (at + length > message.length) fail();
      fields.push({ number, bytes: message.subarray(at, at + length) });
      at += length;
      continue;
    } else fail();
    if (at > message.length) fail();
  }
  return fields;
}

function proofsOf(header: Buffer): { proofs: Proof[]; signedHeaderData: Buffer | null } {
  const proofs: Proof[] = [];
  let signedHeaderData: Buffer | null = null;
  for (const field of readFields(header)) {
    if (!field.bytes) continue;
    if (field.number === 10000) signedHeaderData = field.bytes;
    else if (field.number === 2 || field.number === 3) {
      const parts = readFields(field.bytes);
      const key = parts.find((part) => part.number === 1)?.bytes;
      const signature = parts.find((part) => part.number === 2)?.bytes;
      if (key && signature) proofs.push({ key, signature, algorithm: field.number === 2 ? "rsa" : "ecdsa" });
    }
  }
  return { proofs, signedHeaderData };
}

function verifies(proof: Proof, signedHeaderData: Buffer, zip: Buffer): boolean {
  try {
    const key = createPublicKey({ key: proof.key, format: "der", type: "spki" });
    if ((proof.algorithm === "rsa") !== (key.asymmetricKeyType === "rsa")) return false;
    const length = Buffer.alloc(4);
    length.writeUInt32LE(signedHeaderData.length);
    const verifier = createVerify("sha256");
    for (const part of [SIGNED_DATA_PREFIX, length, signedHeaderData, zip]) verifier.update(part);
    return verifier.verify(key, proof.signature);
  } catch {
    return false;
  }
}

/** Checks a store package for `expectedId`; returns its ZIP and developer key, or throws (French message). */
export function verifyCrx(data: Buffer, expectedId: string): VerifiedCrx {
  if (data.length < 12 || data.toString("latin1", 0, 4) !== "Cr24") throw new UnpackError("Le Chrome Web Store n'a pas renvoyé d'extension .crx.");
  if (data.readUInt32LE(4) !== 3) throw new UnpackError("Format .crx obsolète refusé : seules les extensions CRX3 signées sont installées depuis le Web Store.");
  const headerSize = data.readUInt32LE(8);
  if (headerSize > MAX_HEADER_SIZE || 12 + headerSize >= data.length) throw new UnpackError("Le fichier .crx est tronqué.");
  const header = data.subarray(12, 12 + headerSize);
  const zip = data.subarray(12 + headerSize);
  const { proofs, signedHeaderData } = proofsOf(header);
  const crxId = signedHeaderData ? readFields(signedHeaderData).find((field) => field.number === 1)?.bytes : undefined;
  if (!signedHeaderData || !crxId || crxId.length !== 16) throw new UnpackError("Le fichier .crx n'indique pas l'identifiant de l'extension.");
  if (idFromBytes(crxId) !== expectedId) throw new UnpackError("Le paquet reçu ne correspond pas à l'extension demandée : installation refusée.");
  const developer = proofs.find((proof) => extensionIdFromKey(proof.key) === expectedId);
  if (!developer) throw new UnpackError("Aucune clé du paquet ne correspond à l'identifiant de l'extension : installation refusée.");
  if (!proofs.every((proof) => verifies(proof, signedHeaderData, zip))) throw new UnpackError("La signature de l'extension est invalide : installation refusée.");
  return { zip: Buffer.from(zip), publicKey: Buffer.from(developer.key) };
}
