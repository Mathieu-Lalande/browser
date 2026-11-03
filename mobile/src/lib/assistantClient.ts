import Anthropic from "@anthropic-ai/sdk";
import {
  assistantModel,
  BLOCKING_MAX_TOKENS,
  FALLBACK_BETA,
  messageProgress,
  SYSTEM_PROMPT,
  type AnswerProgress,
  type AssistantModelId,
  type HistoryMessage,
} from "@shared/assistant";

/**
 * The phone's Claude API call (ADR-044), through the official SDK. React Native's `fetch` cannot
 * stream a response body, so the answer comes in one message (`BLOCKING_MAX_TOKENS`). The key is
 * the user's own, on their own device: `dangerouslyAllowBrowser` only lifts the SDK's guard
 * against shipping a shared key in a web page (Expo web).
 */
function client(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, authToken: null, baseURL: "https://api.anthropic.com", maxRetries: 2, dangerouslyAllowBrowser: true });
}

export async function askClaude(apiKey: string, model: AssistantModelId, messages: HistoryMessage[], signal: AbortSignal): Promise<AnswerProgress> {
  const message = await client(apiKey).beta.messages.create(
    {
      model,
      max_tokens: BLOCKING_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages,
      output_config: { effort: assistantModel(model).effort },
      cache_control: { type: "ephemeral" },
      betas: [FALLBACK_BETA],
      fallbacks: "default",
    },
    { signal },
  );
  return messageProgress(message);
}

export async function testClaude(apiKey: string, model: AssistantModelId): Promise<void> {
  await client(apiKey).models.retrieve(model);
}

export const isAbort = (error: unknown) => error instanceof Anthropic.APIUserAbortError;

export function errorMessage(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return "Clé d'API refusée par Anthropic : vérifiez-la dans les paramètres.";
  if (error instanceof Anthropic.RateLimitError) return "Trop de requêtes : réessayez dans un instant.";
  if (error instanceof Anthropic.APIConnectionError) return "Impossible de joindre Anthropic : vérifiez la connexion.";
  if (error instanceof Anthropic.APIError) return `Erreur de l'API d'Anthropic (${error.status ?? "?"}).`;
  return "L'assistant n'a pas pu répondre.";
}
