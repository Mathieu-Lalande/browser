import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import {
  EMPTY_VAULT,
  passwordOrigin,
  sanitizeVault,
  type PasswordResult,
  type PasswordVault,
  type PasswordsStatus,
} from "@shared/passwords";
import { JsonFile } from "../storage/json-file";

/**
 * The saved passwords (ADR-025): `passwords.json` in the profile holds one blob encrypted with
 * `safeStorage` (Keychain, DPAPI, libsecret/kwallet). No keychain encryption (e.g. Linux without
 * a keyring, where Electron reports it unavailable): nothing is saved, with a French message. Should
 * the "basic" store be in use anyway, `browser://passwords` says the protection is weak. The
 * decrypted vault only lives in main.
 */

const VERSION = 1;

interface Stored {
  ciphertext: string;
}

const UNAVAILABLE = "Le chiffrement du système n'est pas disponible : les mots de passe ne peuvent pas être enregistrés sur cet appareil.";
const LOCKED = "Les mots de passe enregistrés ne peuvent pas être déchiffrés (trousseau du système verrouillé ou changé) : rien n'est modifié.";

let state: { vault: PasswordVault; file: JsonFile<Stored>; locked: boolean; origins: Set<string> } | null = null;
let notify: () => void = () => {};

/** Called after every change (windows refresh the key icon, `browser://passwords` re-lists). */
export function setPasswordsNotifier(listener: () => void): void {
  notify = listener;
}

/**
 * Test hook: `BROWSER_TEST_PLAIN_KEYCHAIN=1` lets Linux without a keyring (CI, xvfb) use Chromium's
 * in-memory "basic" key, so e2e tests can save. Unpackaged app only (ADR-018).
 */
const TEST_PLAIN_KEYCHAIN = !app.isPackaged && process.env.BROWSER_TEST_PLAIN_KEYCHAIN === "1";

function opened(): NonNullable<typeof state> {
  if (state) return state;
  if (TEST_PLAIN_KEYCHAIN) safeStorage.setUsePlainTextEncryption(true);
  const file = new JsonFile<Stored>({
    path: join(app.getPath("userData"), "passwords.json"),
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
  state = { vault, file, locked, origins: new Set(vault.entries.map((entry) => entry.origin)) };
  return state;
}

export function passwordsStatus(): PasswordsStatus {
  opened();
  if (!safeStorage.isEncryptionAvailable()) return { available: false, message: UNAVAILABLE, weak: false };
  if (opened().locked) return { available: false, message: LOCKED, weak: false };
  const weak = process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text";
  return { available: true, message: null, weak };
}

export function currentVault(): PasswordVault {
  return opened().vault;
}

/** Encrypts and writes `next`; refused (nothing changes) without keychain encryption. */
export function writeVault(next: PasswordVault): PasswordResult {
  const status = passwordsStatus();
  if (!status.available) return { ok: false, message: status.message ?? UNAVAILABLE };
  const current = opened();
  let ciphertext: string;
  try {
    ciphertext = safeStorage.encryptString(JSON.stringify(next)).toString("base64");
  } catch {
    return { ok: false, message: UNAVAILABLE };
  }
  if (!current.file.save({ ciphertext })) return { ok: false, message: "Le fichier des mots de passe n'a pas pu être écrit." };
  current.vault = next;
  current.origins = new Set(next.entries.map((entry) => entry.origin));
  notify();
  return { ok: true };
}

/** Whether passwords are saved for the page at `url` (exact origin): the address bar's key. */
export function hasPasswordsFor(url: string): boolean {
  const origin = passwordOrigin(url);
  return !!origin && opened().origins.has(origin);
}

export const newPasswordId = () => randomBytes(12).toString("base64url");
