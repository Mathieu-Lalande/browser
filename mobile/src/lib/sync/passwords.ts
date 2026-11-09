import type { PasswordVault } from "@shared/passwords";
import { passwordRecords, sanitizeSyncedPassword, type SyncedPassword } from "@shared/passwords-sync";
import type { Settings } from "@shared/settings";
import type { CollectionAdapter } from "@shared/sync/engine";

/** What password sync needs of the secure-store vault (`PasswordStore`). */
export interface PasswordSyncStore {
  readonly ready: boolean;
  readonly current: PasswordVault;
  applySynced(upserts: readonly { id: string; data: SyncedPassword }[], deletes: readonly string[]): unknown;
}

/**
 * Saved passwords and "never" sites (ADR-050), same records as the desktop; opt-in
 * (`settings.passwords.sync`). The vault stays in `expo-secure-store`; the engine's mirror of this
 * collection is sealed before it reaches AsyncStorage.
 */
export function passwordsAdapter(store: { settings(): Settings }, vault: PasswordSyncStore): CollectionAdapter<SyncedPassword> {
  return {
    name: "passwords",
    enabled: () => store.settings().passwords.sync && vault.ready,
    snapshot: () => passwordRecords(vault.current),
    sanitize: (value, id) => sanitizeSyncedPassword(value, id),
    apply: ({ upserts, deletes }) => void vault.applySynced(upserts, deletes),
  };
}
