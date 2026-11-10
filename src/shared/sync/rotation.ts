import { fromBase64Url, toBase64Url, type RandomBytes } from "./bytes";
import { deriveKeys, generateSyncKey, unwrapKey, wrapKey } from "./crypto";
import type { SyncCredentials } from "./pairing";
import type { DevicesResponse, KeyringResponse } from "./protocol";

/**
 * Revoking one device (ADR-056). The sync key is shared by every device, so removing one means
 * moving the others to a new key:
 *
 * 1. The revoking device draws a new key and wraps it under the current one for each device that
 *    stays, bound to the new epoch and to that device's auth id (`wrapKey`).
 * 2. The relay, in one step, deletes the revoked tokens (and the legacy shared token), stores the
 *    wraps, bumps the epoch and erases the data encrypted with the old key.
 * 3. Every remaining device gets 412 on its next request, fetches its own wrap with its own token
 *    (`followRotation`), and uploads its data again under the new key (new record ids too).
 *
 * The revoked device still knows the old key, so it could open any wrap: what keeps the new key
 * from it is that the relay no longer accepts its token. See the threat model in ADR-056.
 */

export interface RotationPlan {
  epoch: number;
  /** Relay tokens to delete. */
  revoke: string[];
  /** Auth id → new key wrapped for that device. */
  wraps: Record<string, string>;
  /** This device's credentials once the relay accepted the rotation. */
  next: SyncCredentials;
}

/**
 * Plans a rotation that keeps only this device and `keep` (the auth ids of the devices still listed,
 * the revoked one left out). Any other relay token is revoked too: a pending pairing code, or a token
 * the revoked device may have minted for itself before it was removed.
 */
export function planRotation(credentials: SyncCredentials, relay: DevicesResponse, keep: Iterable<string>, rng: RandomBytes): RotationPlan {
  const self = credentials.authId;
  if (!self || relay.self !== self) throw new Error("This device has no token of its own");
  if (relay.epoch !== (credentials.epoch ?? 0)) throw new Error("Behind the relay's key epoch");
  const wanted = new Set([...keep, self]);
  const stay = relay.devices.filter((device) => wanted.has(device.authId)).map((device) => device.authId);
  const revoke = relay.devices.filter((device) => !wanted.has(device.authId)).map((device) => device.authId);
  const epoch = relay.epoch + 1;
  const current = deriveKeys(fromBase64Url(credentials.syncKey));
  const nextKey = generateSyncKey(rng);
  const wraps: Record<string, string> = {};
  for (const authId of stay) wraps[authId] = wrapKey(current, rng, epoch, authId, nextKey);
  return { epoch, revoke, wraps, next: { ...credentials, syncKey: toBase64Url(nextKey), epoch } };
}

/**
 * Follows the rotations this device missed, one epoch after the other (each key opens the next
 * wrap). Null when it cannot: a wrap is missing (removed from the account, or more rotations than
 * the relay keeps) or does not open (tampered with).
 */
export function followRotation(credentials: SyncCredentials, keyring: KeyringResponse): SyncCredentials | null {
  const authId = credentials.authId;
  if (!authId) return null;
  let epoch = credentials.epoch ?? 0;
  let key = fromBase64Url(credentials.syncKey);
  for (const entry of keyring.wraps) {
    if (entry.epoch <= epoch) continue;
    if (entry.epoch !== epoch + 1) return null;
    try {
      key = unwrapKey(deriveKeys(key), entry.epoch, authId, entry.wrap);
    } catch {
      return null;
    }
    epoch = entry.epoch;
  }
  if (epoch !== keyring.epoch) return null;
  return { ...credentials, syncKey: toBase64Url(key), epoch };
}
