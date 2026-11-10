import { isRecordId } from "./crypto";

/**
 * Wire protocol of the sync relay (`server/`, ADR-019). The server stores opaque records:
 *
 * - `POST /v1/accounts` → 201 `{ accountId, token }` (optional `X-Registration-Secret` header).
 * - `GET /v1/collections/:name?since=<version>&limit=<n>` → `{ records, version, more }`.
 * - `POST /v1/collections/:name` `{ records: [{ id, base, payload }] }` → `{ version, previous, records }`,
 *   or 409 `{ conflicts: [{ id, version }] }` when a record's version is not `base` (nothing written).
 * - `DELETE /v1/account` → 204, everything erased.
 *
 * Auth: `Authorization: Bearer <accountId>.<token>`. Versions are per account and only grow.
 */

export const PROTOCOL_PREFIX = "/v1";
/** Records per POST (the server refuses more). */
export const MAX_BATCH_RECORDS = 200;
/** One record envelope, base64url characters. */
export const MAX_PAYLOAD_CHARS = 256 * 1024;
/** One request body (bytes): the server answers 413 above. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** Records per GET page. */
export const PAGE_SIZE = 500;

export interface WireRecord {
  /** HMAC'd record id (32 hex). */
  id: string;
  /** Server version of this write. */
  version: number;
  /** Server time of this write (epoch ms). */
  modified: number;
  /** Encrypted envelope, or null: removed from the server (expired), not a user deletion. */
  payload: string | null;
}

export interface PullResponse {
  records: WireRecord[];
  /** Version to ask `since` next time (the last record returned when `more`). */
  version: number;
  more: boolean;
}

export interface PushRecord {
  id: string;
  /** Version of the record this write replaces; 0 when the client never saw it on the server. */
  base: number;
  payload: string | null;
}

export interface PushResponse {
  /** Account version after the write. */
  version: number;
  /** Collection version before the write (lets a client that was up to date skip its own echo). */
  previous: number;
  records: { id: string; version: number }[];
}

export interface ConflictResponse {
  conflicts: { id: string; version: number }[];
}

export interface AccountResponse {
  accountId: string;
  token: string;
  /** The first device's auth id (ADR-056; absent from relays that predate it). */
  authId?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isVersion = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export const isAccountId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
export const isToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value);

function parseWireRecord(value: unknown): WireRecord | null {
  if (!isRecord(value) || !isRecordId(value.id) || !isVersion(value.version)) return null;
  const payload = value.payload;
  if (payload !== null && (typeof payload !== "string" || payload.length > MAX_PAYLOAD_CHARS)) return null;
  return { id: value.id, version: value.version, modified: isVersion(value.modified) ? value.modified : 0, payload };
}

/** Validates a server answer; anything malformed is a protocol error (null). */
export function parsePullResponse(value: unknown): PullResponse | null {
  if (!isRecord(value) || !Array.isArray(value.records) || !isVersion(value.version)) return null;
  const records: WireRecord[] = [];
  for (const item of value.records) {
    const record = parseWireRecord(item);
    if (!record) return null;
    records.push(record);
  }
  return { records, version: value.version, more: value.more === true };
}

export function parsePushResponse(value: unknown): PushResponse | null {
  if (!isRecord(value) || !isVersion(value.version) || !isVersion(value.previous) || !Array.isArray(value.records)) return null;
  const records: PushResponse["records"] = [];
  for (const item of value.records) {
    if (!isRecord(item) || !isRecordId(item.id) || !isVersion(item.version)) return null;
    records.push({ id: item.id, version: item.version });
  }
  return { version: value.version, previous: value.previous, records };
}

export function parseAccountResponse(value: unknown): AccountResponse | null {
  if (!isRecord(value) || !isAccountId(value.accountId) || !isToken(value.token)) return null;
  return { accountId: value.accountId, token: value.token, ...(isAccountId(value.authId) ? { authId: value.authId } : {}) };
}

// --- Devices and key rotation (ADR-056) ---------------------------------------------------------
//
// - `POST /v1/accounts` also answers the first device's `authId`; `POST /v1/devices` → 201
//   `{ authId, token }`: a token for the device a pairing code is shown to (expires unused in 1 h).
// - `GET /v1/devices` → `{ epoch, self, legacy, devices: [{ authId, createdAt, pending }] }`.
// - `DELETE /v1/devices/self` → 204 (this device leaves).
// - `GET /v1/keyring?since=<epoch>` → `{ epoch, wraps: [{ epoch, wrap }] }`, the caller's wraps only.
// - `POST /v1/keyring` `{ epoch, revoke, wraps }` → `{ epoch }`: revokes, stores the wraps, wipes the
//   data; 409 when `epoch` is not the next one or `wraps` does not cover exactly the remaining devices.
// - Collection requests send `X-Sync-Epoch`; 412 `{ epoch }` once the key was rotated.

export interface DeviceTokenResponse {
  authId: string;
  token: string;
}

export interface RelayDevice {
  authId: string;
  createdAt: number;
  /** A pairing token not used yet. */
  pending: boolean;
}

export interface DevicesResponse {
  epoch: number;
  /** The caller's auth id (null: the legacy shared token). */
  self: string | null;
  /** The account still accepts the shared token of devices paired before ADR-056. */
  legacy: boolean;
  devices: RelayDevice[];
}

export interface KeyringResponse {
  epoch: number;
  wraps: { epoch: number; wrap: string }[];
}

const isWrap = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{40,200}$/.test(value);

export function parseDeviceTokenResponse(value: unknown): DeviceTokenResponse | null {
  if (!isRecord(value) || !isAccountId(value.authId) || !isToken(value.token)) return null;
  return { authId: value.authId, token: value.token };
}

export function parseDevicesResponse(value: unknown): DevicesResponse | null {
  if (!isRecord(value) || !isVersion(value.epoch) || !Array.isArray(value.devices)) return null;
  if (value.self !== null && !isAccountId(value.self)) return null;
  const devices: RelayDevice[] = [];
  for (const item of value.devices) {
    if (!isRecord(item) || !isAccountId(item.authId)) return null;
    devices.push({ authId: item.authId, createdAt: isVersion(item.createdAt) ? item.createdAt : 0, pending: item.pending === true });
  }
  return { epoch: value.epoch, self: value.self, legacy: value.legacy === true, devices };
}

export function parseKeyringResponse(value: unknown): KeyringResponse | null {
  if (!isRecord(value) || !isVersion(value.epoch) || !Array.isArray(value.wraps)) return null;
  const wraps: KeyringResponse["wraps"] = [];
  for (const item of value.wraps) {
    if (!isRecord(item) || !isVersion(item.epoch) || !isWrap(item.wrap)) return null;
    wraps.push({ epoch: item.epoch, wrap: item.wrap });
  }
  return { epoch: value.epoch, wraps: wraps.sort((a, b) => a.epoch - b.epoch) };
}
