import { authorization, normalizeServerUrl, type SyncCredentials } from "./pairing";
import {
  PROTOCOL_PREFIX,
  parseAccountResponse,
  parsePullResponse,
  parsePushResponse,
  type AccountResponse,
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
  | "crypto";

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
    private readonly credentials: Pick<SyncCredentials, "serverUrl" | "accountId" | "token">,
  ) {}

  /** Creates an account on `serverUrl` (the first device). */
  static async createAccount(transport: Transport, serverUrl: string, registrationSecret?: string): Promise<AccountResponse> {
    const base = normalizeServerUrl(serverUrl);
    if (!base) throw new SyncError("protocol", "Adresse de serveur invalide");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (registrationSecret) headers["x-registration-secret"] = registrationSecret;
    const response = await send(transport, { method: "POST", url: `${base}${PROTOCOL_PREFIX}/accounts`, headers, body: "{}" });
    if (response.status === 403) throw new SyncError("auth", "Inscription refusée par le serveur (code d'inscription ?)");
    check(response, [201]);
    const account = parseAccountResponse(parseJson(response.body));
    if (!account) throw new SyncError("protocol", "Réponse inattendue du serveur");
    return account;
  }

  async pull(collection: string, since: number, limit?: number): Promise<PullResponse> {
    const query = `since=${since}${limit ? `&limit=${limit}` : ""}`;
    const response = await this.request("GET", `/collections/${collection}?${query}`);
    check(response, [200]);
    const parsed = parsePullResponse(parseJson(response.body));
    if (!parsed) throw new SyncError("protocol", "Réponse inattendue du serveur");
    return parsed;
  }

  async push(collection: string, records: PushRecord[]): Promise<PushResponse> {
    const response = await this.request("POST", `/collections/${collection}`, JSON.stringify({ records }));
    if (response.status === 409) throw new SyncError("conflict", "Données modifiées sur le serveur entre-temps");
    check(response, [200]);
    const parsed = parsePushResponse(parseJson(response.body));
    if (!parsed) throw new SyncError("protocol", "Réponse inattendue du serveur");
    return parsed;
  }

  /** Erases the account and all its data on the server. */
  async deleteAccount(): Promise<void> {
    const response = await this.request("DELETE", "/account");
    // Already gone counts as done.
    if (response.status === 401 || response.status === 404) return;
    check(response, [204, 200]);
  }

  private request(method: HttpRequest["method"], path: string, body?: string): Promise<HttpResponse> {
    const headers: Record<string, string> = { authorization: authorization(this.credentials) };
    if (body !== undefined) headers["content-type"] = "application/json";
    return send(this.transport, { method, url: `${this.credentials.serverUrl}${PROTOCOL_PREFIX}${path}`, headers, body });
  }
}

async function send(transport: Transport, request: HttpRequest): Promise<HttpResponse> {
  try {
    return await transport(request);
  } catch (error) {
    throw new SyncError("offline", error instanceof Error ? error.message : "Serveur injoignable");
  }
}

function check(response: HttpResponse, ok: number[]): void {
  if (ok.includes(response.status)) return;
  const { status } = response;
  if (status === 401 || status === 403) throw new SyncError("auth", "Ce compte de synchronisation n'existe plus ou cet appareil n'y a plus accès");
  if (status === 413) throw new SyncError("too-large", "Requête trop volumineuse pour le serveur");
  if (status === 429) throw new SyncError("rate-limited", "Trop de requêtes, nouvel essai plus tard", retryAfter(response));
  if (status === 507) throw new SyncError("too-large", "Quota du compte atteint sur le serveur");
  if (status >= 500) throw new SyncError("server", `Erreur du serveur (${status})`, retryAfter(response));
  throw new SyncError("protocol", `Réponse inattendue du serveur (${status})`);
}
