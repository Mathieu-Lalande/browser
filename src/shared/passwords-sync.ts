import { MAX_ENTRIES, MAX_PASSWORD, MAX_USERNAME, findAccount, isPasswordOrigin, setNever, type PasswordVault } from "./passwords";

/**
 * Password sync records (ADR-050), shared by the desktop and the phone. Opt-in, end-to-end
 * encrypted like every collection (ADR-019); the engine's local mirror of this collection is sealed
 * at rest (`SENSITIVE_COLLECTIONS`). One record per account, keyed by origin + username (the same
 * account saved on two devices is one record), and one per "Jamais pour ce site" origin. Conflicts:
 * last writer wins per record, deletions are tombstones. `lastUsedAt` and entry ids stay local.
 */

export type SyncedPassword =
  | { kind: "account"; origin: string; username: string; password: string; createdAt: number; updatedAt: number }
  | { kind: "never"; origin: string };

export const accountLocalId = (origin: string, username: string) => `a:${origin}\n${username}`;
export const neverLocalId = (origin: string) => `n:${origin}`;

const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** The vault as sync records, by local id (deterministic for an unchanged vault). */
export function passwordRecords(vault: PasswordVault): Map<string, SyncedPassword> {
  const records = new Map<string, SyncedPassword>();
  for (const { origin, username, password, createdAt, updatedAt } of vault.entries) {
    records.set(accountLocalId(origin, username), { kind: "account", origin, username, password, createdAt, updatedAt });
  }
  for (const origin of vault.never) records.set(neverLocalId(origin), { kind: "never", origin });
  return records;
}

/** Validates a record decrypted from another device; its local id must match its content. */
export function sanitizeSyncedPassword(value: unknown, localId: string): SyncedPassword | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isPasswordOrigin(v.origin)) return null;
  if (v.kind === "never") return localId === neverLocalId(v.origin) ? { kind: "never", origin: v.origin } : null;
  if (v.kind !== "account" || typeof v.username !== "string" || v.username.length > MAX_USERNAME) return null;
  if (typeof v.password !== "string" || v.password === "" || v.password.length > MAX_PASSWORD) return null;
  if (localId !== accountLocalId(v.origin, v.username)) return null;
  const createdAt = isTime(v.createdAt) ? Math.floor(v.createdAt) : 0;
  const updatedAt = isTime(v.updatedAt) ? Math.max(Math.floor(v.updatedAt), createdAt) : createdAt;
  return { kind: "account", origin: v.origin, username: v.username, password: v.password, createdAt, updatedAt };
}

/**
 * Applies remote winners to the vault: accounts updated in place (id and last use kept) or added
 * with `newId()`, "never" origins added; deletions remove the account or the origin.
 */
export function mergeSyncedPasswords(
  vault: PasswordVault,
  upserts: readonly { id: string; data: SyncedPassword }[],
  deletes: readonly string[],
  newId: () => string,
): PasswordVault {
  let next: PasswordVault = { entries: [...vault.entries], never: [...vault.never] };
  for (const localId of deletes) {
    if (localId.startsWith("n:")) next = setNever(next, localId.slice(2), false);
    else if (localId.startsWith("a:")) next.entries = next.entries.filter((entry) => accountLocalId(entry.origin, entry.username) !== localId);
  }
  for (const { data } of upserts) {
    if (data.kind === "never") {
      if (!next.never.includes(data.origin)) next = setNever(next, data.origin, true);
      continue;
    }
    const { origin, username, password, createdAt, updatedAt } = data;
    const known = findAccount(next, origin, username);
    if (known) next.entries = next.entries.map((entry) => (entry === known ? { ...entry, password, createdAt, updatedAt } : entry));
    else if (next.entries.length < MAX_ENTRIES) next.entries.push({ id: newId(), origin, username, password, createdAt, updatedAt, lastUsedAt: null });
  }
  return next;
}
