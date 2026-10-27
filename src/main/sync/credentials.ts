import { chmodSync, readFileSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { safeStorage } from "electron";
import { isSyncCredentials, type SyncCredentials } from "@shared/sync/pairing";

/**
 * The sync secrets (token and key) on disk: `sync-credentials.json` in the profile, encrypted with
 * the OS keychain through `safeStorage` (Keychain, DPAPI, libsecret/kwallet) when available, and
 * otherwise readable only by the user (0600). Never in `sync.json`, never sent to the UI except as
 * the pairing code the user asks for.
 */

interface Stored {
  version: 1;
  encrypted: boolean;
  value: string;
}

export function credentialsStore(dir: string) {
  const path = join(dir, "sync-credentials.json");
  return {
    load(): SyncCredentials | null {
      try {
        const stored = JSON.parse(readFileSync(path, "utf8")) as Stored;
        const json = stored.encrypted ? safeStorage.decryptString(Buffer.from(stored.value, "base64")) : stored.value;
        const value = JSON.parse(json) as unknown;
        return isSyncCredentials(value) ? value : null;
      } catch {
        return null;
      }
    },
    save(credentials: SyncCredentials | null): void {
      if (!credentials) {
        rmSync(path, { force: true });
        return;
      }
      const json = JSON.stringify(credentials);
      const encrypted = safeStorage.isEncryptionAvailable();
      const stored: Stored = { version: 1, encrypted, value: encrypted ? safeStorage.encryptString(json).toString("base64") : json };
      const temp = `${path}.tmp`;
      writeFileSync(temp, JSON.stringify(stored), { mode: 0o600 });
      renameSync(temp, path);
      try {
        chmodSync(path, 0o600);
      } catch {
        // Windows: ACLs of the profile folder apply.
      }
    },
  };
}
