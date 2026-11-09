import { t } from "../i18n";
import { chunkTexts, fitTranslation } from "./segments";
import { TranslationError, type HttpClient, type TranslationProvider } from "./providers";

/**
 * Runs translations through a provider (ADR-036): splits texts into requests within the provider's
 * limits, sends them one at a time, fits each answer (`fitTranslation`) and remembers recent ones
 * (a page re-rendering the same text does not cost a second request). The HTTP call is injected.
 */

export interface TranslateResult {
  /** One per text: the translation, or null when the provider gave none (the text stays). */
  texts: (string | null)[];
  /** The source language the provider detected (when asked to), else null. */
  detected: string | null;
}

const CACHE_SIZE = 4000;

export class Translator {
  private readonly cache = new Map<string, string>();

  constructor(
    readonly provider: TranslationProvider,
    private readonly http: HttpClient,
  ) {}

  async translate(texts: readonly string[], from: string | null, to: string): Promise<TranslateResult> {
    const results: (string | null)[] = texts.map((text) => this.cache.get(this.key(text, from, to)) ?? null);
    const missing = texts.map((_, index) => index).filter((index) => results[index] === null);
    const pending = missing.map((index) => texts[index]);
    const { maxChars, maxItems } = this.provider.limits;
    let detected: string | null = null;
    for (const [start, end] of chunkTexts(pending, maxChars, maxItems)) {
      const chunk = pending.slice(start, end);
      let response;
      try {
        response = await this.http(this.provider.buildRequest(chunk, from, to));
      } catch {
        throw new TranslationError("network", t("translateTranslator.unreachableNetworkTimeout", { label: this.provider.label }));
      }
      const batch = this.provider.parseResponse(response, chunk.length);
      detected ??= batch.detected;
      batch.texts.forEach((translated, offset) => {
        const index = missing[start + offset];
        const fitted = fitTranslation(texts[index], translated);
        results[index] = fitted;
        if (fitted !== null) this.remember(this.key(texts[index], from, to), fitted);
      });
    }
    return { texts: results, detected };
  }

  private key(text: string, from: string | null, to: string): string {
    return `${from ?? "auto"}\u0000${to}\u0000${text}`;
  }

  private remember(key: string, value: string): void {
    this.cache.delete(key);
    this.cache.set(key, value);
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
  }
}

/** A short sample to check the credentials ("Tester"): resolves to its translation. */
export async function testTranslation(translator: Translator, to: string): Promise<string> {
  const sample = to === "en" ? "Bonjour, le monde !" : "Hello, world!";
  const { texts } = await translator.translate([sample], to === "en" ? "fr" : "en", to);
  if (!texts[0]) throw new TranslationError("invalid", t("translateTranslator.returnedNoTranslation", { label: translator.provider.label }));
  return texts[0];
}
