import { join } from "node:path";
import { app, safeStorage } from "electron";
import { TRANSLATE_PROVIDERS, type TranslateProviderId } from "@shared/translate/providers";
import type { TranslateKeysStatus } from "@shared/translate/state";
import { JsonFile } from "../storage/json-file";

/**
 * API keys of the translation providers (ADR-036): `translate-keys.json` holds one blob encrypted
 * with `safeStorage`, like the passwords (ADR-025). Without OS encryption nothing is saved (French
 * message in the settings). Keys never go back to the UI: it only learns which ones are set.
 */

const VERSION = 1;
const MAX_KEY_LENGTH = 500;

type Keys = Partial<Record<TranslateProviderId, string>>;

const UNAVAILABLE = "Le chiffrement du système n'est pas disponible : les clés d'API ne peuvent pas être enregistrées sur cet appareil.";

/** Same test hook as the password vault (unpackaged app only, ADR-018). */
const TEST_PLAIN_KEYCHAIN = !app.isPackaged && process.env.BROWSER_TEST_PLAIN_KEYCHAIN === "1";

export class TranslateKeyStore {
  private keys: Keys | null = null;
  private file: JsonFile<{ ciphertext: string }> | null = null;

  private opened(): Keys {
    if (this.keys) return this.keys;
    if (TEST_PLAIN_KEYCHAIN) safeStorage.setUsePlainTextEncryption(true);
    this.file = new JsonFile<{ ciphertext: string }>({
      path: join(app.getPath("userData"), "translate-keys.json"),
      version: VERSION,
      parse: (data) => {
        const ciphertext = (data as { ciphertext?: unknown } | null)?.ciphertext;
        return typeof ciphertext === "string" ? { ciphertext } : null;
      },
    });
    const stored = this.file.load();
    let keys: Keys = {};
    if (stored) {
      try {
        const parsed = JSON.parse(safeStorage.decryptString(Buffer.from(stored.ciphertext, "base64"))) as Record<string, unknown>;
        for (const { id } of TRANSLATE_PROVIDERS) if (typeof parsed[id] === "string") keys[id] = parsed[id];
      } catch {
        keys = {};
      }
    }
    this.keys = keys;
    return keys;
  }

  get(provider: TranslateProviderId): string {
    return this.opened()[provider] ?? "";
  }

  status(): TranslateKeysStatus {
    const keys = this.opened();
    const available = safeStorage.isEncryptionAvailable();
    return {
      available,
      message: available ? null : UNAVAILABLE,
      keys: { deepl: !!keys.deepl, libretranslate: !!keys.libretranslate, google: !!keys.google },
    };
  }

  /** Saves (or, empty, removes) a provider's key; refused without OS encryption. */
  set(provider: TranslateProviderId, key: string): { ok: true } | { ok: false; message: string } {
    const keys = { ...this.opened() };
    const clean = key.trim().slice(0, MAX_KEY_LENGTH);
    if (clean) keys[provider] = clean;
    else delete keys[provider];
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, message: UNAVAILABLE };
    let ciphertext: string;
    try {
      ciphertext = safeStorage.encryptString(JSON.stringify(keys)).toString("base64");
    } catch {
      return { ok: false, message: UNAVAILABLE };
    }
    if (!this.file!.save({ ciphertext })) return { ok: false, message: "Le fichier des clés n'a pas pu être écrit." };
    this.keys = keys;
    return { ok: true };
  }
}

export const translateKeys = new TranslateKeyStore();
