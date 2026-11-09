import { t } from "../i18n";
import type { BetaMessage, BetaRawMessageStreamEvent, BetaStopReason } from "@anthropic-ai/sdk/resources/beta/messages";
import type { TurnStatus } from "./conversation";

/**
 * Turning the Messages API's answer into the assistant turn the UIs draw (ADR-044). The SDK
 * parses the server-sent events; this reducer only folds the typed events into the answer's
 * text and outcome, so the desktop (streamed) and the phone (one message) end the same way.
 */

export interface AnswerProgress {
  text: string;
  /** The model that answered (a fallback model after a refusal). */
  model: string | null;
  stopReason: BetaStopReason | null;
  /** A model declined and the server-side fallback took over. */
  fellBack: boolean;
}

export const emptyProgress = (): AnswerProgress => ({ text: "", model: null, stopReason: null, fellBack: false });

export function reduceStreamEvent(progress: AnswerProgress, event: BetaRawMessageStreamEvent): AnswerProgress {
  switch (event.type) {
    case "message_start":
      return { ...progress, model: event.message.model ?? progress.model };
    case "content_block_start":
      if (event.content_block.type === "fallback") return { ...progress, fellBack: true };
      if (event.content_block.type === "text" && event.content_block.text) return { ...progress, text: progress.text + event.content_block.text };
      return progress;
    case "content_block_delta":
      return event.delta.type === "text_delta" ? { ...progress, text: progress.text + event.delta.text } : progress;
    case "message_delta":
      return { ...progress, stopReason: event.delta.stop_reason ?? progress.stopReason };
    default:
      return progress;
  }
}

/** The same outcome from a complete (non-streamed) message. */
export function messageProgress(message: BetaMessage): AnswerProgress {
  let text = "";
  let fellBack = false;
  for (const block of message.content) {
    if (block.type === "text") text += block.text;
    if (block.type === "fallback") fellBack = true;
  }
  return { text, model: message.model, stopReason: message.stop_reason, fellBack };
}

export const REFUSAL_MESSAGE = t("assistantStream.assistantRefusedAnswerRequest");
export const TRUNCATED_NOTE = t("assistantStream.responseInterruptedReachedMaximum");

/** How a finished answer ends: refused (whatever text came before), cut by the length limit, or done. */
export function finalStatus(progress: AnswerProgress): TurnStatus {
  if (progress.stopReason === "refusal") return "refused";
  if (progress.stopReason === "max_tokens" || progress.stopReason === "model_context_window_exceeded") return "truncated";
  return "done";
}
