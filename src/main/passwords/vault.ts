import { t } from "@shared/i18n";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { safeStorage } from "electron";
import { Emitter } from "@shared/emitter";
import {
  EMPTY_VAULT,
  passwordOrigin,
  sanitizeVault,
  type PasswordResult,
  type PasswordVault,
  type PasswordsStatus,
} from "@shared/passwords";
import { appServices } from "../app-services-ref";
import { JsonFile } from "../storage/json-file";

const VERSION = 1;

interface Stored {
  ciphertext: string;
}

const UNAVAILABLE = (): string => t("passwordsVault.systemEncryptionIsntAvailable");
const LOCKED = (): string => t("passwordsVault.savedPasswordsCantDecrypted");

export interface VaultOptions {
  /** Where `passwords.json` lives. */
  profileDir: string;
  /**
   * Test hook (`BROWSER_TEST_PLAIN_KEYCHAIN=1`, unpackaged app only, ADR-018): Linux without a
   * keyring (CI, xvfb) uses Chromium's in-memory "basic" key, so e2e tests can save.
   */
  plainKeychain?: boolean;
}

/**
 * The saved passwords (ADR-025): `passwords.json` in the profile holds one blob encrypted with
 * `safeStorage` (Keychain, DPAPI, libsecret/kwallet). No keychain encryption (e.g. Linux without
 * a keyring, where Electron reports it unavailable): nothing is saved, with a French message. Should
 * the "basic" store be in use anyway, `browser://passwords` says the protection is weak. The
 * decrypted vault only lives in main.
 */
export class PasswordVaultStore {
  private state: { vault: PasswordVault; file: JsonFile<Stored>; locked: boolean; origins: Set<string> } | null = null;
  private readonly changes = new Emitter();

  constructor(private readonly options: VaultOptions) {}

  /** After every change (windows refresh the key icon, `browser://passwords` re-lists). */
  onChanged(listener: () => void): () => void {
    return this.changes.on(listener);
  }

  status(): PasswordsStatus {
    const { locked } = this.opened();
    if (!safeStorage.isEncryptionAvailable()) return { available: false, message: UNAVAILABLE(), weak: false };
    if (locked) return { available: false, message: LOCKED(), weak: false };
    const weak = process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text";
    return { available: true, message: null, weak };
  }

  current(): PasswordVault {
    return this.opened().vault;
  }

  /** Encrypts and writes `next`; refused (nothing changes) without keychain encryption. */
  write(next: PasswordVault): PasswordResult {
    const status = this.status();
    if (!status.available) return { ok: false, message: status.message ?? UNAVAILABLE() };
    const current = this.opened();
    let ciphertext: string;
    try {
      ciphertext = safeStorage.encryptString(JSON.stringify(next)).toString("base64");
    } catch {
      return { ok: false, message: UNAVAILABLE() };
    }
    if (!current.file.save({ ciphertext })) return { ok: false, message: t("passwordsVault.passwordFileCouldntWritten") };
    current.vault = next;
    current.origins = new Set(next.entries.map((entry) => entry.origin));
    this.changes.emit();
    return { ok: true };
  }

  /** Whether passwords are saved for the page at `url` (exact origin): the address bar's key. */
  hasPasswordsFor(url: string): boolean {
    const origin = passwordOrigin(url);
    return !!origin && this.opened().origins.has(origin);
  }

  private opened(): NonNullable<PasswordVaultStore["state"]> {
    if (this.state) return this.state;
    if (this.options.plainKeychain) safeStorage.setUsePlainTextEncryption(true);
    const file = new JsonFile<Stored>({
      path: join(this.options.profileDir, "passwords.json"),
      version: VERSION,
      parse: (data) => {
        const ciphertext = (data as Partial<Stored> | null)?.ciphertext;
        return typeof ciphertext === "string" ? { ciphertext } : null;
      },
    });
    const stored = file.load();
    let vault = EMPTY_VAULT;
    let locked = false;
    if (stored) {
      try {
        vault = sanitizeVault(JSON.parse(safeStorage.decryptString(Buffer.from(stored.ciphertext, "base64"))));
      } catch {
        // Keychain unavailable or changed: the file is kept as it is and never written over.
        locked = true;
      }
    }
    this.state = { vault, file, locked, origins: new Set(vault.entries.map((entry) => entry.origin)) };
    return this.state;
  }
}

// Function facades over the app's vault, for the password features and IPC handlers.
const vault = () => appServices().passwords;
export const passwordsStatus = (): PasswordsStatus => vault().status();
export const currentVault = (): PasswordVault => vault().current();
export const writeVault = (next: PasswordVault): PasswordResult => vault().write(next);
export const hasPasswordsFor = (url: string): boolean => vault().hasPasswordsFor(url);

export const newPasswordId = () => randomBytes(12).toString("base64url");
