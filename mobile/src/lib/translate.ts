import { TRANSLATE_WALKER } from "@shared/translate/page-script";
import { sanitizeSegments, type Segment } from "@shared/translate/segments";
import { createProvider, TRANSLATE_PROVIDERS, type HttpClient, type ProviderConfig, type TranslateProviderId } from "@shared/translate/providers";
import { Translator } from "@shared/translate/translator";
import type { TranslateSettings } from "@shared/settings";
import type { SecretStore } from "./passwords";

/**
 * Page translation on the phone (ADR-036): the shared providers and walker. WebViews have no usable
 * isolated world: the walker runs in the page's world and talks to the app through the bridge, which
 * any frame can post to. As for the password capture (ADR-025), the script is injected by the app
 * with a fresh random nonce per request, kept in its closure; `TranslateBridge` only accepts
 * messages carrying it, from the main frame's origin, between injection and the next load. The
 * texts a message carries are only ever sent to the provider the user chose (bounded and
 * validated), and translations go back as text (`nodeValue`), never HTML.
 */

export const TRANSLATE_MESSAGE = "browser-translate";
/** Larger messages are ignored (a batch is bounded far below this). */
const MAX_MESSAGE_LENGTH = 200_000;
/** Per batch from the page (the provider requests are split further by the core). */
const BATCH_CHARS = 8000;
const BATCH_COUNT = 100;

/** The page script's global (the nonce makes it this request's own). */
const globalOf = (nonce: string) => `window[${JSON.stringify(`__browserTranslate_${nonce}`)}]`;

/**
 * Starts translating: creates the walker, then posts batches `{ type, nonce, segments }`; the app
 * answers each one with `applyScript`, which writes it and posts the next. With nothing left, the
 * script waits for new content (debounced, capped by the walker) and posts again.
 */
export function translateScript(nonce: string): string {
  return `(function(nonce){
var post=window.ReactNativeWebView&&window.ReactNativeWebView.postMessage.bind(window.ReactNativeWebView);
if(!post||!document.body)return;
var api=(${TRANSLATE_WALKER})();
function send(segments){post(JSON.stringify({type:${JSON.stringify(TRANSLATE_MESSAGE)},nonce:nonce,segments:segments}));}
api.pump=function(){var batch=api.next(${BATCH_CHARS},${BATCH_COUNT});if(batch.length)return send(batch);
send([]);api.wait().then(function(more){if(more)api.pump();});};
window["__browserTranslate_"+nonce]=api;
api.start();api.pump();
})(${JSON.stringify(nonce)});true;`;
}

/** Writes a batch's translations, then asks for the next one. */
export function applyScript(nonce: string, pairs: readonly [number, string][]): string {
  return `(function(){var t=${globalOf(nonce)};if(t){t.apply(${JSON.stringify(pairs)});t.pump();}})();true;`;
}

/** "Afficher l'original". */
export function restoreScript(nonce: string): string {
  return `(function(){var t=${globalOf(nonce)};if(t)t.restore();})();true;`;
}

const originOf = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
};

/** Ties page messages to the translation the app started on the current document. */
export class TranslateBridge {
  private nonce: string | null = null;
  private origin: string | null = null;

  constructor(private readonly newNonce: () => string) {}

  get active(): boolean {
    return this.nonce !== null;
  }

  /** A main-frame load started: the previous document's translation is gone. */
  loadStarted(): void {
    this.nonce = null;
    this.origin = null;
  }

  /** The script starting a translation of the page at `url` (null: not a web page). */
  start(url: string): string | null {
    this.origin = originOf(url);
    this.nonce = this.origin ? this.newNonce() : null;
    return this.nonce ? translateScript(this.nonce) : null;
  }

  apply(pairs: readonly [number, string][]): string | null {
    return this.nonce ? applyScript(this.nonce, pairs) : null;
  }

  /** The script restoring the original; the bridge then ignores the page. */
  restore(): string | null {
    const script = this.nonce ? restoreScript(this.nonce) : null;
    this.nonce = null;
    this.origin = null;
    return script;
  }

  /**
   * A WebView message: `undefined` when it is not a translation message, null when it is not for
   * the running translation (wrong nonce, other origin, none running), else the validated batch.
   */
  parse(data: unknown, messageUrl: string, pageUrl: string): Segment[] | null | undefined {
    if (typeof data !== "string" || data.length > MAX_MESSAGE_LENGTH || !data.includes(TRANSLATE_MESSAGE)) return undefined;
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return undefined;
    }
    if (typeof message !== "object" || message === null || (message as { type?: unknown }).type !== TRANSLATE_MESSAGE) return undefined;
    if (!this.nonce || (message as { nonce?: unknown }).nonce !== this.nonce) return null;
    if (originOf(messageUrl) !== this.origin || originOf(pageUrl) !== this.origin) return null;
    return sanitizeSegments((message as { segments?: unknown }).segments);
  }
}

/** 128 random bits, hex. */
export const translateNonce = (randomBytes: (length: number) => Uint8Array): string =>
  Array.from(randomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");

// --- Provider and keys -------------------------------------------------------------------------

const keyName = (provider: TranslateProviderId) => `translate.key.${provider}`;

/** API keys in `expo-secure-store` (Keychain / Keystore), never in AsyncStorage. */
export class TranslateKeys {
  private cache = new Map<TranslateProviderId, string>();

  constructor(
    private readonly store: SecretStore,
    private readonly options?: object,
  ) {}

  async get(provider: TranslateProviderId): Promise<string> {
    if (!this.cache.has(provider)) this.cache.set(provider, (await this.store.getItemAsync(keyName(provider)).catch(() => null)) ?? "");
    return this.cache.get(provider)!;
  }

  async set(provider: TranslateProviderId, key: string): Promise<void> {
    const clean = key.trim().slice(0, 500);
    if (clean) await this.store.setItemAsync(keyName(provider), clean, this.options);
    else await this.store.deleteItemAsync(keyName(provider));
    this.cache.set(provider, clean);
  }
}

export const needsKey = (provider: TranslateProviderId) => TRANSLATE_PROVIDERS.find((entry) => entry.id === provider)!.needsKey;

/** The provider configuration of the settings plus its key, or null when translation is off. */
export function providerConfig(settings: TranslateSettings, apiKey: string): ProviderConfig | null {
  if (settings.provider === "none") return null;
  return { provider: settings.provider, apiKey, deeplPlan: settings.deeplPlan, libreUrl: settings.libreUrl };
}

/** The phone's HTTP call: no cookies, a timeout, the answer bounded. */
export const phoneHttp: HttpClient = async (request) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      credentials: "omit",
      signal: controller.signal,
    });
    const body = await response.text();
    if (body.length > 2_000_000) throw new Error("response too large");
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
};

/** A translator for a configuration (throws the core's French `config` error when incomplete). */
export const translatorFor = (config: ProviderConfig, http: HttpClient = phoneHttp) => new Translator(createProvider(config), http);
