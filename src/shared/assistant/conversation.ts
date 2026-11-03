import { estimateTokens, type SentSource } from "./context";
import type { AssistantModelId } from "./models";
import { isAssistantAction, MAX_COMPARED_TABS, QUESTION_MAX_LENGTH, type AssistantAction } from "./prompts";

/**
 * The conversation model (ADR-044): one conversation per tab, in memory only (never written to
 * the profile, never synced). The history sent back to the API is append-only: each user turn
 * keeps the exact prompt it was sent with, so a follow-up reuses the cached prefix.
 */

export type TurnStatus = "streaming" | "done" | "stopped" | "truncated" | "refused" | "error";

export interface AssistantTurn {
  id: string;
  role: "user" | "assistant";
  /** User: what the conversation shows (the question or the action's label). Assistant: the answer (Markdown). */
  text: string;
  /** User only: the full message sent (pages included). Never shown, never leaves main. */
  prompt?: string;
  /** User only: the pages the request carried. */
  sent?: SentSource[];
  /** User only: the page was already sent earlier in the conversation (not sent again). */
  reusedContext?: boolean;
  /** Assistant only. */
  status?: TurnStatus;
  /** Assistant only: a French explanation of a failure. */
  error?: string;
  model?: AssistantModelId;
}

/** A turn as the UI receives it (without the prompt). */
export type AssistantTurnView = Omit<AssistantTurn, "prompt">;

/** The text-only message shape of the Messages API. */
export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/** Tokens of earlier turns sent back with a follow-up; the oldest exchanges go first. */
export const HISTORY_TOKEN_BUDGET = 120_000;

const answered = (turn: AssistantTurn | undefined) =>
  !!turn && turn.role === "assistant" && !!turn.text.trim() && (turn.status === "done" || turn.status === "stopped" || turn.status === "truncated");

/**
 * The messages to send for the last user turn of `turns`: the earlier exchanges that got an
 * answer (a failed or refused one is left out with its question), within `budget`, then the
 * last prompt.
 */
export function historyMessages(turns: readonly AssistantTurn[], budget = HISTORY_TOKEN_BUDGET): HistoryMessage[] {
  const last = turns[turns.length - 1];
  if (!last || last.role !== "user") return [];
  const pairs: HistoryMessage[][] = [];
  for (let index = 0; index < turns.length - 1; index++) {
    const turn = turns[index];
    if (turn.role === "user" && answered(turns[index + 1])) {
      pairs.push([
        { role: "user", content: turn.prompt ?? turn.text },
        { role: "assistant", content: turns[index + 1].text },
      ]);
    }
  }
  const current: HistoryMessage = { role: "user", content: last.prompt ?? last.text };
  let used = estimateTokens(current.content);
  const kept: HistoryMessage[][] = [];
  for (let index = pairs.length - 1; index >= 0; index--) {
    const cost = pairs[index].reduce((sum, message) => sum + estimateTokens(message.content), 0);
    if (used + cost > budget) break;
    used += cost;
    kept.unshift(pairs[index]);
  }
  return [...kept.flat(), current];
}

export const viewTurn = ({ prompt: _prompt, ...turn }: AssistantTurn): AssistantTurnView => turn;

// --- Requests from the UIs ------------------------------------------------------------------

export interface AssistantRequest {
  action: AssistantAction;
  /** `ask`: the question. */
  question?: string;
  /** `ask`: send the page along (default true). */
  includePage?: boolean;
  /** `compare-tabs`: tabs of the sender's window. */
  tabIds?: string[];
  /** The user accepted the privacy notice just now. */
  consent?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Validates a request from a UI (IPC, untrusted shapes); null when malformed. */
export function sanitizeAssistantRequest(value: unknown): AssistantRequest | null {
  if (!isRecord(value) || !isAssistantAction(value.action)) return null;
  const request: AssistantRequest = { action: value.action };
  if (value.question !== undefined) {
    if (typeof value.question !== "string" || value.question.length > QUESTION_MAX_LENGTH) return null;
    request.question = value.question;
  }
  if (value.action === "ask" && !request.question?.trim()) return null;
  if (value.includePage !== undefined) {
    if (typeof value.includePage !== "boolean") return null;
    request.includePage = value.includePage;
  }
  if (value.tabIds !== undefined) {
    if (!Array.isArray(value.tabIds) || value.tabIds.length > MAX_COMPARED_TABS || !value.tabIds.every((id) => typeof id === "string" && id.length <= 64)) return null;
    request.tabIds = [...new Set(value.tabIds as string[])];
  }
  if (value.action === "compare-tabs" && (request.tabIds?.length ?? 0) < 2) return null;
  if (value.consent !== undefined) {
    if (typeof value.consent !== "boolean") return null;
    request.consent = value.consent;
  }
  return request;
}

/** Ids of turns, unique within a conversation. */
export function turnId(sequence: number): string {
  return `t${sequence.toString(36)}`;
}
