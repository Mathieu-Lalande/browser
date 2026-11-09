import { t } from "@shared/i18n";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import type { AssistantKeyStatus } from "@shared/assistant/state";
import { JsonFile } from "../storage/json-file";

/**
 * The Anthropic API key of the assistant (ADR-044): `assistant-key.json` holds it encrypted with
 * `safeStorage`, like the translation keys (ADR-036) and the passwords (ADR-025). Without OS
 * encryption nothing is saved. The key never goes back to a UI (only whether one is set), is
 * never synced, never logged, and is only read by main to call the API.
 */

const VERSION = 1;
const MAX_KEY_LENGTH = 500;
const UNAVAILABLE = t("assistantKeys.systemEncryptionIsntAvailable");

/** Same test hook as the password vault (unpackaged app only, ADR-018). */
const TEST_PLAIN_KEYCHAIN = !app.isPackaged && process.env.BROWSER_TEST_PLAIN_KEYCHAIN === "1";

export class AssistantKeyStore {
  private key: string | null = null;
  private file: JsonFile<{ ciphertext: string }> | null = null;

  private opened(): string {
    if (this.key !== null) return this.key;
    if (TEST_PLAIN_KEYCHAIN) safeStorage.setUsePlainTextEncryption(true);
    this.file = new JsonFile<{ ciphertext: string }>({
      path: join(app.getPath("userData"), "assistant-key.json"),
      version: VERSION,
      parse: (data) => {
        const ciphertext = (data as { ciphertext?: unknown } | null)?.ciphertext;
        return typeof ciphertext === "string" ? { ciphertext } : null;
      },
    });
    const stored = this.file.load();
    let key = "";
    if (stored) {
      try {
        key = safeStorage.decryptString(Buffer.from(stored.ciphertext, "base64"));
      } catch {
        key = "";
      }
    }
    this.key = key;
    return key;
  }

  get(): string {
    return this.opened();
  }

  status(): AssistantKeyStatus {
    const set = !!this.opened();
    const available = safeStorage.isEncryptionAvailable();
    return { available, message: available ? null : UNAVAILABLE, set };
  }

  /** Saves (or, empty, removes) the key; refused without OS encryption. */
  set(key: string): { ok: true } | { ok: false; message: string } {
    this.opened();
    const clean = key.trim().slice(0, MAX_KEY_LENGTH);
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, message: UNAVAILABLE };
    let ciphertext: string;
    try {
      ciphertext = safeStorage.encryptString(clean).toString("base64");
    } catch {
      return { ok: false, message: UNAVAILABLE };
    }
    if (!this.file!.save({ ciphertext })) return { ok: false, message: t("assistantKeys.keyFileCouldntWritten") };
    this.key = clean;
    return { ok: true };
  }
}

export const assistantKey = new AssistantKeyStore();
