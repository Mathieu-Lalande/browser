import Anthropic from "@anthropic-ai/sdk";
import { app } from "electron";
import type { HistoryMessage } from "@shared/assistant/conversation";
import { assistantModel, FALLBACK_BETA, STREAM_MAX_TOKENS, type AssistantModelId } from "@shared/assistant/models";
import { SYSTEM_PROMPT } from "@shared/assistant/prompts";
import { emptyProgress, reduceStreamEvent, type AnswerProgress } from "@shared/assistant/stream";

/**
 * The Claude API calls of the assistant (ADR-044), made by main only through the official SDK:
 * outside every browsing session (no cookie, no extension, no page sees them), with the user's
 * key. The address is fixed (an `ANTHROPIC_BASE_URL` in the environment must not redirect the
 * key elsewhere); the unpackaged app accepts a local fake server for the e2e tests.
 */

const API_URL = "https://api.anthropic.com";

function baseUrl(): string {
  const test = app.isPackaged ? undefined : process.env.BROWSER_TEST_ANTHROPIC_URL;
  return test && /^http:\/\/127\.0\.0\.1:\d+$/.test(test) ? test : API_URL;
}

function client(apiKey: string): Anthropic {
  // Explicit credentials only: no token, profile or other variable of the environment is used.
  return new Anthropic({ apiKey, authToken: null, baseURL: baseUrl(), maxRetries: 2 });
}

export interface AnswerOptions {
  apiKey: string;
  model: AssistantModelId;
  messages: HistoryMessage[];
  signal: AbortSignal;
  onProgress: (progress: AnswerProgress) => void;
}

/** Streams an answer; resolves with how it ended (rejects on an API or network error, or a stop). */
export async function streamAnswer({ apiKey, model, messages, signal, onProgress }: AnswerOptions): Promise<AnswerProgress> {
  const stream = client(apiKey).beta.messages.stream(
    {
      model,
      max_tokens: STREAM_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages,
      output_config: { effort: assistantModel(model).effort },
      // The pages of a conversation are its prefix: follow-up questions read them from the cache.
      cache_control: { type: "ephemeral" },
      // A refusal is retried server-side on the model's default fallback.
      betas: [FALLBACK_BETA],
      fallbacks: "default",
    },
    { signal },
  );
  let progress = emptyProgress();
  for await (const event of stream) {
    progress = reduceStreamEvent(progress, event);
    onProgress(progress);
  }
  return progress;
}

/** "Tester" in the settings: the key reaches the API and may use the model (no token spent). */
export async function testKey(apiKey: string, model: AssistantModelId): Promise<void> {
  await client(apiKey).models.retrieve(model);
}

export const isAbort = (error: unknown) => error instanceof Anthropic.APIUserAbortError || (error instanceof Error && error.name === "AbortError");

/** A French explanation of a failed call (never the key, never the request). */
export function errorMessage(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return "Clé d'API refusée par Anthropic : vérifiez-la dans Paramètres → Assistant IA.";
  if (error instanceof Anthropic.PermissionDeniedError) return "Cette clé d'API n'a pas accès à ce modèle.";
  if (error instanceof Anthropic.NotFoundError) return "Modèle introuvable pour cette clé d'API.";
  if (error instanceof Anthropic.RateLimitError) return "Trop de requêtes : réessayez dans un instant.";
  if (error instanceof Anthropic.BadRequestError) return "Requête refusée par Anthropic (page trop longue ou crédit épuisé ?).";
  if (error instanceof Anthropic.InternalServerError) return "Le service d'Anthropic est momentanément indisponible.";
  if (error instanceof Anthropic.APIConnectionError) return "Impossible de joindre Anthropic : vérifiez la connexion.";
  if (error instanceof Anthropic.APIError) return `Erreur de l'API d'Anthropic (${error.status ?? "?"}).`;
  return "L'assistant n'a pas pu répondre.";
}
