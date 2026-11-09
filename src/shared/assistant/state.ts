import { t } from "../i18n";
import type { AssistantTurnView } from "./conversation";
import type { AssistantModelId } from "./models";

/** What the assistant panel draws for a tab (ADR-044). */
export interface AssistantPanelState {
  /** Settings → Assistant IA → "Activer". */
  enabled: boolean;
  /** An API key is saved. */
  configured: boolean;
  /** The privacy notice must be accepted before anything is sent (first use; each private window). */
  needsConsent: boolean;
  isPrivate: boolean;
  model: AssistantModelId;
  /** The tab shows a web page the assistant can read. */
  readable: boolean;
  /** An answer is being written. */
  running: boolean;
  turns: AssistantTurnView[];
  /** The label of a request waiting for the privacy notice ("Accepter et envoyer" sends it). */
  pending: string | null;
}

export interface AssistantKeyStatus {
  /** OS encryption is available (else no key can be saved). */
  available: boolean;
  message: string | null;
  set: boolean;
}

export interface AssistantResult {
  ok: boolean;
  message: string;
  /** Refused because the privacy notice was not accepted (the panel shows it). */
  needsConsent?: boolean;
}

export const PRIVACY_NOTICE = (): string =>
  t("assistantState.textPagesYouChoose");

export const PRIVATE_NOTICE = (): string => t("assistantState.privateWindowAssistantTurned");
