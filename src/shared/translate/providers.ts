import { t } from "../i18n";
import { normalizeLanguage } from "./languages";

/**
 * Translation providers (ADR-036): each one turns texts into one HTTP request and parses its
 * answer, without doing any I/O itself (the desktop's main process and the phone make the call).
 * Pure, so each request and response format is unit-tested against fixtures.
 */

export type TranslateProviderId = "deepl" | "libretranslate" | "google";
/** "none": translation is off (the default: the page's text would leave the device). */
export type TranslateProviderChoice = TranslateProviderId | "none";
export type DeepLPlan = "free" | "pro";

export const TRANSLATE_PROVIDERS: readonly { id: TranslateProviderId; label: string; needsKey: boolean }[] = [
  { id: "deepl", label: "DeepL", needsKey: true },
  { id: "libretranslate", label: "LibreTranslate", needsKey: false },
  { id: "google", label: "Google Cloud Translation", needsKey: true },
];

export const isTranslateProviderId = (value: unknown): value is TranslateProviderId => TRANSLATE_PROVIDERS.some((provider) => provider.id === value);

export const providerLabel = (id: TranslateProviderId): string => TRANSLATE_PROVIDERS.find((provider) => provider.id === id)!.label;

export interface HttpRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export interface HttpResponse {
  status: number;
  body: string;
}

/** Makes the request: no cookies, a timeout, no redirects (main's `fetch`, the phone's `fetch`). */
export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;

/** One provider answer: a translation per text sent (null: none for that one) and the detected source. */
export interface TranslationBatch {
  texts: (string | null)[];
  detected: string | null;
}

export type TranslationErrorKind = "auth" | "quota" | "rate" | "network" | "server" | "invalid" | "config";

/** A failed translation, with the French message the UI shows. */
export class TranslationError extends Error {
  constructor(
    readonly kind: TranslationErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "TranslationError";
  }
}

export interface TranslationProvider {
  readonly id: TranslateProviderId;
  readonly label: string;
  /** Per request: texts and characters (`chunkTexts`). */
  readonly limits: { maxChars: number; maxItems: number };
  /** `from` null: the provider detects the source language. */
  buildRequest(texts: readonly string[], from: string | null, to: string): HttpRequest;
  /** Throws a `TranslationError` for an error status or a malformed answer. */
  parseResponse(response: HttpResponse, count: number): TranslationBatch;
}

/** Credentials and options of the chosen provider (the key comes from the OS keychain). */
export interface ProviderConfig {
  provider: TranslateProviderId;
  apiKey: string;
  deeplPlan: DeepLPlan;
  /** LibreTranslate server, e.g. `https://libretranslate.example.org`. */
  libreUrl: string;
}

const JSON_HEADERS = { "content-type": "application/json", accept: "application/json" };

function parseJson(response: HttpResponse): unknown {
  try {
    return JSON.parse(response.body);
  } catch {
    throw new TranslationError("invalid", t("translateProviders.unreadableResponseFromTranslation"));
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Error statuses shared by the three services. */
function checkStatus(label: string, response: HttpResponse): void {
  const { status } = response;
  if (status >= 200 && status < 300) return;
  if (status === 401 || status === 403) throw new TranslationError("auth", t("translateProviders.refusedApiKey", { label }));
  if (status === 456) throw new TranslationError("quota", t("translateProviders.translationQuotaUsedUp", { label }));
  if (status === 429) throw new TranslationError("rate", t("translateProviders.gettingTooManyRequests", { label }));
  if (status === 400) throw new TranslationError("invalid", t("translateProviders.refusedRequestUnsupportedLanguage", { label }));
  throw new TranslationError("server", t("translateProviders.isntRespondingCorrectlyError", { label, status }));
}

/** Translations of a JSON list, one per text sent; a shorter or longer list is refused. */
function listOf(value: unknown, count: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length !== count) throw new TranslationError("invalid", t("translateProviders.incompleteResponseFrom", { label }));
  return value;
}

const textOrNull = (value: unknown) => (typeof value === "string" ? value : null);

/** The most common source language among per-text detections. */
function mostCommon(codes: readonly (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const code of codes) if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// --- DeepL --------------------------------------------------------------------------------------

/** DeepL API v2 (`/v2/translate`, JSON). Free keys end with ":fx" and use their own host. */
export class DeepLProvider implements TranslationProvider {
  readonly id = "deepl";
  readonly label = "DeepL";
  readonly limits = { maxChars: 30_000, maxItems: 50 };

  constructor(
    private readonly apiKey: string,
    private readonly plan: DeepLPlan,
  ) {}

  get endpoint(): string {
    return this.plan === "free" ? "https://api-free.deepl.com/v2/translate" : "https://api.deepl.com/v2/translate";
  }

  /** DeepL wants a regional English and Portuguese as targets. */
  static targetCode(code: string): string {
    if (code === "en") return "EN-US";
    if (code === "pt") return "PT-PT";
    return code.toUpperCase();
  }

  buildRequest(texts: readonly string[], from: string | null, to: string): HttpRequest {
    const body: Record<string, unknown> = { text: texts, target_lang: DeepLProvider.targetCode(to) };
    if (from) body.source_lang = from.toUpperCase();
    return {
      url: this.endpoint,
      method: "POST",
      headers: { ...JSON_HEADERS, authorization: `DeepL-Auth-Key ${this.apiKey}` },
      body: JSON.stringify(body),
    };
  }

  parseResponse(response: HttpResponse, count: number): TranslationBatch {
    checkStatus(this.label, response);
    const json = parseJson(response);
    const items = listOf(isRecord(json) ? json.translations : null, count, this.label);
    const texts = items.map((item) => (isRecord(item) ? textOrNull(item.text) : null));
    const detected = mostCommon(items.map((item) => (isRecord(item) ? normalizeLanguage(item.detected_source_language) : null)));
    return { texts, detected };
  }
}

// --- LibreTranslate ----------------------------------------------------------------------------

/** LibreTranslate (`POST /translate`, JSON, `q` as a list): self-hosted or a public server. */
export class LibreTranslateProvider implements TranslationProvider {
  readonly id = "libretranslate";
  readonly label = "LibreTranslate";
  readonly limits = { maxChars: 4000, maxItems: 50 };

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  get endpoint(): string {
    return `${this.baseUrl.replace(/\/+$/, "")}/translate`;
  }

  buildRequest(texts: readonly string[], from: string | null, to: string): HttpRequest {
    const body: Record<string, unknown> = { q: texts, source: from ?? "auto", target: to, format: "text" };
    if (this.apiKey) body.api_key = this.apiKey;
    return { url: this.endpoint, method: "POST", headers: { ...JSON_HEADERS }, body: JSON.stringify(body) };
  }

  parseResponse(response: HttpResponse, count: number): TranslationBatch {
    if (response.status === 400 || response.status === 403) {
      // LibreTranslate explains itself in `error` (missing key, unsupported language…).
      const json = (() => {
        try {
          return JSON.parse(response.body) as unknown;
        } catch {
          return null;
        }
      })();
      const reason = isRecord(json) && typeof json.error === "string" ? json.error.slice(0, 200) : null;
      if (reason) throw new TranslationError(response.status === 403 ? "auth" : "invalid", `LibreTranslate : ${reason}`);
    }
    checkStatus(this.label, response);
    const json = parseJson(response);
    if (!isRecord(json)) throw new TranslationError("invalid", t("translateProviders.incompleteResponseFrom", { label: this.label }));
    // A single text may come back as a plain string.
    const translated = typeof json.translatedText === "string" && count === 1 ? [json.translatedText] : json.translatedText;
    const texts = listOf(translated, count, this.label).map(textOrNull);
    const detections = Array.isArray(json.detectedLanguage) ? json.detectedLanguage : [json.detectedLanguage];
    const detected = mostCommon(detections.map((item) => (isRecord(item) ? normalizeLanguage(item.language) : null)));
    return { texts, detected };
  }
}

// --- Google Cloud Translation (v2, "Basic") ----------------------------------------------------

/** Google Cloud Translation v2 with an API key (sent as a header, never in the URL). */
export class GoogleTranslateProvider implements TranslationProvider {
  readonly id = "google";
  readonly label = "Google Cloud Translation";
  readonly limits = { maxChars: 5000, maxItems: 128 };
  static readonly ENDPOINT = "https://translation.googleapis.com/language/translate/v2";

  constructor(private readonly apiKey: string) {}

  buildRequest(texts: readonly string[], from: string | null, to: string): HttpRequest {
    // format "text": plain text in and out (no HTML entities to decode).
    const body: Record<string, unknown> = { q: texts, target: to, format: "text" };
    if (from) body.source = from;
    return { url: GoogleTranslateProvider.ENDPOINT, method: "POST", headers: { ...JSON_HEADERS, "x-goog-api-key": this.apiKey }, body: JSON.stringify(body) };
  }

  parseResponse(response: HttpResponse, count: number): TranslationBatch {
    checkStatus(this.label, response);
    const json = parseJson(response);
    const data = isRecord(json) && isRecord(json.data) ? json.data : null;
    const items = listOf(data?.translations, count, this.label);
    const texts = items.map((item) => (isRecord(item) ? textOrNull(item.translatedText) : null));
    const detected = mostCommon(items.map((item) => (isRecord(item) ? normalizeLanguage(item.detectedSourceLanguage) : null)));
    return { texts, detected };
  }
}

// --- Choice ------------------------------------------------------------------------------------

/**
 * A server URL for LibreTranslate: https, or http (a self-hosted server on the local network),
 * without credentials, query nor fragment. Returns the normalized URL or null.
 */
export function normalizeServerUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.search || url.hash) return null;
  return url.href.replace(/\/+$/, "");
}

/** Whether the server is reached without encryption (the settings say so). */
export const isPlainHttp = (url: string) => /^http:/i.test(url);

/** The provider for `config`, or a `config` error naming what is missing. */
export function createProvider(config: ProviderConfig): TranslationProvider {
  const key = config.apiKey.trim();
  switch (config.provider) {
    case "deepl":
      if (!key) throw new TranslationError("config", t("translateProviders.addDeeplApiKey"));
      return new DeepLProvider(key, config.deeplPlan);
    case "google":
      if (!key) throw new TranslationError("config", t("translateProviders.addGoogleCloudApi"));
      return new GoogleTranslateProvider(key);
    case "libretranslate": {
      const url = normalizeServerUrl(config.libreUrl);
      if (!url) throw new TranslationError("config", t("translateProviders.enterLibretranslateServerAddress"));
      return new LibreTranslateProvider(url, key);
    }
  }
}
