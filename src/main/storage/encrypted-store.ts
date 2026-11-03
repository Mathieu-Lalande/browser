import { safeStorage } from "electron";
import { Emitter } from "@shared/emitter";
import { JsonFile } from "./json-file";

interface Stored {
  ciphertext: string;
}

export interface EncryptedStoreOptions<T> {
  /** The file in the profile (`autofill.json`…). */
  path: string;
  version: number;
  empty: T;
  /** Cleans decrypted data (the file may come from an older version, or be damaged). */
  sanitize(value: unknown): T;
  /** Test hook (ADR-018): Chromium's in-memory "basic" key on Linux without a keyring. */
  plainKeychain?: boolean;
}

export type EncryptedStatus = { available: true; weak: boolean } | { available: false; reason: "unavailable" | "locked" };

/**
 * One JSON document encrypted as a whole with `safeStorage` (Keychain, DPAPI, libsecret/kwallet),
 * like the password vault (ADR-025): without keychain encryption nothing is written, and a file
 * that cannot be decrypted (keychain locked or changed) is kept as it is and never written over.
 * The decrypted data only lives in main.
 */
export class EncryptedStore<T> {
  private state: { data: T; file: JsonFile<Stored>; locked: boolean } | null = null;
  private readonly changes = new Emitter();

  constructor(private readonly options: EncryptedStoreOptions<T>) {}

  onChanged(listener: () => void): () => void {
    return this.changes.on(listener);
  }

  status(): EncryptedStatus {
    const { locked } = this.opened();
    if (!safeStorage.isEncryptionAvailable()) return { available: false, reason: "unavailable" };
    if (locked) return { available: false, reason: "locked" };
    return { available: true, weak: process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text" };
  }

  current(): T {
    return this.opened().data;
  }

  /** Encrypts and writes `next`; false (nothing changes) without keychain encryption or on a write error. */
  write(next: T): boolean {
    if (!this.status().available) return false;
    const state = this.opened();
    let ciphertext: string;
    try {
      ciphertext = safeStorage.encryptString(JSON.stringify(next)).toString("base64");
    } catch {
      return false;
    }
    if (!state.file.save({ ciphertext })) return false;
    state.data = next;
    this.changes.emit();
    return true;
  }

  private opened(): NonNullable<EncryptedStore<T>["state"]> {
    if (this.state) return this.state;
    if (this.options.plainKeychain) safeStorage.setUsePlainTextEncryption(true);
    const file = new JsonFile<Stored>({
      path: this.options.path,
      version: this.options.version,
      parse: (data) => {
        const ciphertext = (data as Partial<Stored> | null)?.ciphertext;
        return typeof ciphertext === "string" ? { ciphertext } : null;
      },
    });
    const stored = file.load();
    let data = this.options.empty;
    let locked = false;
    if (stored) {
      try {
        data = this.options.sanitize(JSON.parse(safeStorage.decryptString(Buffer.from(stored.ciphertext, "base64"))));
      } catch {
        locked = true;
      }
    }
    this.state = { data, file, locked };
    return this.state;
  }
}
