import { t as tr, t } from "../i18n";
import { authorization, normalizeServerUrl, type SyncCredentials } from "./pairing";
import {
  PROTOCOL_PREFIX,
  parseAccountResponse,
  parseDevicesResponse,
  parseDeviceTokenResponse,
  parseKeyringResponse,
  parsePullResponse,
  parsePushResponse,
  type AccountResponse,
  type DeviceTokenResponse,
  type DevicesResponse,
  type KeyringResponse,
  type PullResponse,
  type PushRecord,
  type PushResponse,
} from "./protocol";

/** Minimal HTTP, injected by each platform (Electron `net.fetch`, React Native `fetch`, test doubles). */
export interface HttpRequest {
  method: "GET" | "POST" | "DELETE";
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  /** Lowercase header names. */
  headers: Record<string, string>;
  body: string;
}

/** Throws when the request could not be made at all (offline, DNS, TLS…). */
export type Transport = (request: HttpRequest) => Promise<HttpResponse>;

export type SyncErrorKind =
  /** Network unreachable: retried with backoff, data kept locally. */
  | "offline"
  /** Token refused or account deleted (reset from another device): pairing needed again. */
  | "auth"
  /** A record changed on the server since it was read (409): pull again, then retry. */
  | "conflict"
  | "rate-limited"
  | "too-large"
  | "server"
  /** The answer was not what the protocol says (wrong server, proxy page…). */
  | "protocol"
  /** Records could not be decrypted: another sync key (reset elsewhere) or tampering. */
  | "crypto"
  /** Another device rotated the sync key (412, ADR-056): fetch this device's wrap, then sync again. */
  | "rotated"
  /** The relay predates ADR-056 (no per-device tokens). */
  | "unsupported";

export class SyncError extends Error {
  constructor(
    readonly kind: SyncErrorKind,
    message: string,
    /** Server-requested delay before retrying (429/503), ms. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "SyncError";
  }
}

/** A transport built on a WHATWG `fetch` (Electron's `net.fetch`, React Native, Node 22). */
export function fetchTransport(fetchImpl: (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  status: number;
  headers: { forEach(callback: (value: string, key: string) => void): void };
  text(): Promise<string>;
}>, timeoutMs = 30_000): Transport {
  return async (request) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Request timed out")), timeoutMs);
    });
    try {
      const response = await Promise.race([fetchImpl(request.url, request), timeout]);
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => (headers[key.toLowerCase()] = value));
      return { status: response.status, headers, body: await Promise.race([response.text(), timeout]) };
    } finally {
      clearTimeout(timer);
    }
  };
}

function retryAfter(response: HttpResponse): number | undefined {
  const seconds = Number(response.headers["retry-after"]);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 3600) * 1000 : undefined;
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/** Typed calls to the relay. Every failure becomes a `SyncError`. */
export class SyncClient {
  constructor(
    private readonly transport: Transport,
    private readonly credentials: Pick<SyncCredentials, "serverUrl" | "accountId" | "token" | "epoch">,
  ) {}

  /** Creates an account on `serverUrl` (the first device). */
  static async createAccount(transport: Transport, serverUrl: string, registrationSecret?: string): Promise<AccountResponse> {
    const base = normalizeServerUrl(serverUrl);
    if (!base) throw new SyncError("protocol", t("syncClient.invalidServerAddress"));
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (registrationSecret) headers["x-registration-secret"] = registrationSecret;
    const response = await send(transport, { method: "POST", url: `${base}${PROTOCOL_PREFIX}/accounts`, headers, body: "{}" });
    if (response.status === 403) throw new SyncError("auth", t("syncClient.registrationRefusedServerRegistration"));
    check(response, [201]);
    const account = parseAccountResponse(parseJson(response.body));
    if (!account) throw new SyncError("protocol", t("syncClient.unexpectedServerResponse"));
    return account;
  }

  async pull(collection: string, since: number, limit?: number): Promise<PullResponse> {
    const query = `since=${since}${limit ? `&limit=${limit}` : ""}`;
    const response = await this.request("GET", `/collections/${collection}?${query}`, undefined, true);
    check(response, [200]);
    const parsed = parsePullResponse(parseJson(response.body));
    if (!parsed) throw new SyncError("protocol", t("syncClient.unexpectedServerResponse"));
    return parsed;
  }

  async push(collection: string, records: PushRecord[]): Promise<PushResponse> {
    const response = await this.request("POST", `/collections/${collection}`, JSON.stringify({ records }), true);
    if (response.status === 409) throw new SyncError("conflict", t("syncClient.dataChangedServerMeantime"));
    check(response, [200]);
    const parsed = parsePushResponse(parseJson(response.body));
    if (!parsed) throw new SyncError("protocol", t("syncClient.unexpectedServerResponse"));
    return parsed;
  }

  /** Erases the account and all its data on the server. */
  async deleteAccount(): Promise<void> {
    const response = await this.request("DELETE", "/account");
    // Already gone counts as done.
    if (response.status === 401 || response.status === 404) return;
    check(response, [204, 200]);
  }

  /** A token for a new device (pairing code, or a device leaving the legacy shared token). */
  async createDevice(): Promise<DeviceTokenResponse> {
    const response = await this.request("POST", "/devices", "{}");
    unsupported(response);
    check(response, [201]);
    return parsed(parseDeviceTokenResponse(parseJson(response.body)));
  }

  async listDevices(): Promise<DevicesResponse> {
    const response = await this.request("GET", "/devices");
    unsupported(response);
    check(response, [200]);
    return parsed(parseDevicesResponse(parseJson(response.body)));
  }

  /** This device leaves: its token stops working (already gone counts as done). */
  async leave(): Promise<void> {
    const response = await this.request("DELETE", "/devices/self");
    if ([401, 403, 404].includes(response.status)) return;
    check(response, [204, 200]);
  }

  /** This device's wrapped keys for the epochs after `since`. */
  async keyring(since: number): Promise<KeyringResponse> {
    const response = await this.request("GET", `/keyring?since=${since}`);
    unsupported(response);
    check(response, [200]);
    return parsed(parseKeyringResponse(parseJson(response.body)));
  }

  /** Rotates to `epoch` (revoking `revoke`); a 409 means another rotation or a new device came first. */
  async rotate(epoch: number, revoke: string[], wraps: Record<string, string>): Promise<void> {
    const response = await this.request("POST", "/keyring", JSON.stringify({ epoch, revoke, wraps }));
    if (response.status === 409) throw new SyncError("conflict", t("syncClient.dataChangedServerMeantime"));
    unsupported(response);
    check(response, [200]);
  }

  private request(method: HttpRequest["method"], path: string, body?: string, keyed = false): Promise<HttpResponse> {
    const headers: Record<string, string> = { authorization: authorization(this.credentials) };
    // Collection requests name the key generation they use: 412 once another device rotated it.
    if (keyed) headers["x-sync-epoch"] = String(this.credentials.epoch ?? 0);
    if (body !== undefined) headers["content-type"] = "application/json";
    return send(this.transport, { method, url: `${this.credentials.serverUrl}${PROTOCOL_PREFIX}${path}`, headers, body });
  }
}

async function send(transport: Transport, request: HttpRequest): Promise<HttpResponse> {
  try {
    return await transport(request);
  } catch (error) {
    throw new SyncError("offline", error instanceof Error ? error.message : tr("syncClient.serverUnreachable"));
  }
}

function parsed<T>(value: T | null): T {
  if (!value) throw new SyncError("protocol", t("syncClient.unexpectedServerResponse"));
  return value;
}

/** Relays older than ADR-056 have no device routes. */
function unsupported(response: HttpResponse): void {
  if (response.status === 404 || response.status === 405) throw new SyncError("unsupported", t("syncClient.serverTooOld"));
}

function check(response: HttpResponse, ok: number[]): void {
  if (ok.includes(response.status)) return;
  const { status } = response;
  if (status === 412) throw new SyncError("rotated", t("syncClient.keyRotated"));
  if (status === 401 || status === 403) throw new SyncError("auth", t("syncClient.syncAccountNoLonger"));
  if (status === 413) throw new SyncError("too-large", t("syncClient.requestTooLargeServer"));
  if (status === 429) throw new SyncError("rate-limited", t("syncClient.tooManyRequestsRetrying"), retryAfter(response));
  if (status === 507) throw new SyncError("too-large", t("syncClient.accountQuotaReachedServer"));
  if (status >= 500) throw new SyncError("server", t("syncClient.serverError", { status }), retryAfter(response));
  throw new SyncError("protocol", t("syncClient.unexpectedServerResponse2", { status }));
}
