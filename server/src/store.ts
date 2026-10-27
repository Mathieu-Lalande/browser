import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";

/**
 * Storage of the relay: one JSON file per account, written atomically (temporary file, fsync,
 * rename) before a write is acknowledged. Nothing in it is readable without the devices' key:
 * record payloads are ciphertext, record ids are keyed hashes, the token is stored hashed.
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

export interface Account {
  id: string;
  /** SHA-256 of the bearer token, hex. */
  tokenHash: string;
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
