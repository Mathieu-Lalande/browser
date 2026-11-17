/**
 * Password vault lock (ADR-059): after `lockMinutes` without showing, copying or exporting a
 * password, doing so again asks the system first (Touch ID, or a native confirmation). 0: never
 * locks. Pure: the delays offered and the decision.
 */

export const VAULT_LOCK_MINUTES = [0, 1, 5, 15, 60] as const;
export type VaultLockMinutes = (typeof VAULT_LOCK_MINUTES)[number];
export const DEFAULT_VAULT_LOCK: VaultLockMinutes = 15;

export interface VaultLockState {
  locked: boolean;
  lockMinutes: number;
}

/** Locked when the delay is on and the last unlock (or use) is older than it, or never happened. */
export function isVaultLocked(lockMinutes: number, lastUsedAt: number | null, now: number): boolean {
  if (!lockMinutes) return false;
  return lastUsedAt === null || now - lastUsedAt > lockMinutes * 60_000;
}
