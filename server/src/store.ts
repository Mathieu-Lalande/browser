import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";

/**
 * Storage of the relay: one JSON file per account, written atomically (temporary file, fsync,
 * rename) before a write is acknowledged. Nothing in it is readable without the devices' key:
 * record payloads are ciphertext, record ids are keyed hashes, tokens are stored hashed, wrapped keys
 * are sealed under a key the server never had.
 *
 * Node 22's `node:sqlite` is still flagged experimental, so this dependency-free file store is
 * used; volumes are small (a few MB per account) and the process is single-threaded.
 */

export interface StoredRecord {
  version: number;
  modified: number;
  /** Encrypted envelope, or null when a device removed it (expired). */
  payload: string | null;
}

/** One device's own token (ADR-056). */
export interface DeviceAuth {
  /** SHA-256 of the device's bearer token, hex. */
  tokenHash: string;
  createdAt: number;
  /** First request made with it; a pairing token never claimed expires (`PAIRING_TTL_MS`). */
  claimedAt?: number;
}

/** The next sync key wrapped for each remaining device after a rotation (ADR-056); opaque here. */
export interface KeyWraps {
  epoch: number;
  /** Device auth id → wrapped key (base64url), delivered only to that device. */
  wraps: Record<string, string>;
}

export interface Account {
  id: string;
  /**
   * SHA-256 of the account-wide token shared by every device paired before ADR-056 (hex), or
   * null: such devices move to their own token at their next sync, and a rotation revokes it.
   */
  tokenHash: string | null;
  /** Per-device tokens by auth id (ADR-056). Missing on accounts written before. */
  devices?: Record<string, DeviceAuth>;
  /** Generation of the sync key (0 until the first rotation). */
  epoch?: number;
  /** Last rotations, oldest first, so a device that slept through several can catch up. */
  keyring?: KeyWraps[];
  createdAt: number;
  /** Last version handed out (per account, only grows). */
  version: number;
  /** Sum of the payload lengths (quota). */
  bytes: number;
  collections: Record<string, Record<string, StoredRecord>>;
}

const ACCOUNT_FILE = /^([0-9a-f]{32})\.json$/;

export class FileStore {
  private readonly cache = new Map<string, Account>();
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, "accounts");
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  private path(id: string): string {
    if (!/^[0-9a-f]{32}$/.test(id)) throw new Error("Invalid account id");
    return join(this.dir, `${id}.json`);
  }

  get(id: string): Account | null {
    const cached = this.cache.get(id);
    if (cached) return cached;
    let account: Account;
    try {
      account = JSON.parse(readFileSync(this.path(id), "utf8")) as Account;
    } catch {
      return null;
    }
    if (account.id !== id) return null;
    this.cache.set(id, account);
    // Keep memory bounded: accounts are reloaded from disk on demand.
    if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
    return account;
  }

  has(id: string): boolean {
    return this.get(id) !== null;
  }

  /** Persists an account (atomically) before the caller answers. */
  save(account: Account): void {
    const path = this.path(account.id);
    const temp = `${path}.${process.pid}.tmp`;
    const fd = openSync(temp, "w", 0o600);
    try {
      writeSync(fd, JSON.stringify(account));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
    this.cache.set(account.id, account);
  }

  delete(id: string): void {
    this.cache.delete(id);
    rmSync(this.path(id), { force: true });
  }

  /** Number of accounts (health/metrics). */
  count(): number {
    return readdirSync(this.dir).filter((name) => ACCOUNT_FILE.test(name)).length;
  }
}
