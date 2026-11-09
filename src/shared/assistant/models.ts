/**
 * The Claude models the assistant offers (ADR-044). Claude Opus 5.5 is the default, run at a low
 * effort so answers start quickly; Claude Fable 5.1 is the "plus puissant" choice. Thinking is
 * left to the API (adaptive on both: neither accepts it disabled), and both get the server-side
 * fallback on a refusal (`fallbacks: "default"`).
 */

import { t } from "../i18n";

export const ASSISTANT_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", get hint() { return t("assistantModels.recommendedFastAccurate") }, effort: "low" },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", get hint() { return t("assistantModels.morePowerfulSlowerMore") }, effort: "medium" },
] as const;

export type AssistantModelId = (typeof ASSISTANT_MODELS)[number]["id"];
export type AssistantEffort = (typeof ASSISTANT_MODELS)[number]["effort"];

export const DEFAULT_ASSISTANT_MODEL: AssistantModelId = "claude-opus-5-5";

export const isAssistantModel = (value: unknown): value is AssistantModelId => ASSISTANT_MODELS.some((model) => model.id === value);

export const assistantModel = (id: AssistantModelId) => ASSISTANT_MODELS.find((model) => model.id === id) ?? ASSISTANT_MODELS[0];

/** Beta header of the `fallbacks: "default"` form (server-side refusal fallback). */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Output ceiling of a streamed answer (streaming avoids HTTP timeouts on long ones). */
export const STREAM_MAX_TOKENS = 64_000;
/** Output ceiling of a non-streamed answer (the phone, whose `fetch` cannot stream). */
export const BLOCKING_MAX_TOKENS = 16_000;
