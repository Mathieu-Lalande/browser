import { isLocalHost } from "../hosts";
import { fromBase64Url, toBase64Url, utf8Decode, utf8Encode } from "./bytes";
import { SYNC_KEY_BYTES } from "./crypto";
import { isAccountId, isToken } from "./protocol";

/**
 * Everything a device needs to join a sync account: server, account id, auth token and the sync
 * key. Whoever holds it can read and replace all the synced data, so it is only shown after an
 * explicit action, with a warning, and never sent anywhere by the app.
 */
export interface SyncCredentials {
  /** Server origin (and optional path prefix), without trailing slash. */
  serverUrl: string;
  accountId: string;
  token: string;
  /** 32 bytes, base64url. */
  syncKey: string;
}

const PAIRING_PREFIX = "browser-sync:1:";
const MAX_URL = 512;

/**
 * Normalizes a server address typed by the user: https only, except http for the machine itself
 * or the local network (self-hosted on a NAS, tests). No credentials, query or fragment.
 * Returns null when unusable.
 */
export function normalizeServerUrl(input: string): string | null {
  const text = input.trim();
  if (!text || text.length > MAX_URL) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalHost(url.hostname))) return null;
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

export function isSyncCredentials(value: unknown): value is SyncCredentials {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  if (typeof c.serverUrl !== "string" || normalizeServerUrl(c.serverUrl) !== c.serverUrl) return false;
  if (!isAccountId(c.accountId) || !isToken(c.token) || typeof c.syncKey !== "string") return false;
  try {
    return fromBase64Url(c.syncKey).length === SYNC_KEY_BYTES;
  } catch {
    return false;
  }
}

/** The pairing code: shown as a QR code and as copyable text. */
export function encodePairingCode(credentials: SyncCredentials): string {
  const json = JSON.stringify({ s: credentials.serverUrl, a: credentials.accountId, t: credentials.token, k: credentials.syncKey });
  return PAIRING_PREFIX + toBase64Url(utf8Encode(json));
}

/** Reads a pairing code (spaces and line breaks from copy/paste ignored); null when invalid. */
export function decodePairingCode(code: string): SyncCredentials | null {
  const text = code.replace(/\s+/g, "");
  if (!text.startsWith(PAIRING_PREFIX) || text.length > 2048) return null;
  try {
    const value = JSON.parse(utf8Decode(fromBase64Url(text.slice(PAIRING_PREFIX.length)))) as Record<string, unknown>;
    const credentials = { serverUrl: value.s, accountId: value.a, token: value.t, syncKey: value.k };
    return isSyncCredentials(credentials) ? credentials : null;
  } catch {
    return null;
  }
}

/** `Authorization` header value for the relay. */
export const authorization = (credentials: Pick<SyncCredentials, "accountId" | "token">) =>
  `Bearer ${credentials.accountId}.${credentials.token}`;
