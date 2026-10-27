import { randomBytes } from "node:crypto";
import type { RandomBytes } from "@shared/sync/bytes";

/** Desktop random source for the sync engine: Node's CSPRNG (OpenSSL / the OS). */
export const nodeRandomBytes: RandomBytes = (length) => new Uint8Array(randomBytes(length));
