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

export const PRIVACY_NOTICE =
  "Le texte des pages que vous choisissez (titre, adresse, contenu, sélection) et vos questions sont envoyés à Anthropic avec votre clé d'API pour produire la réponse. Rien n'est envoyé sans une action de votre part ; les conversations restent en mémoire et ne sont jamais synchronisées.";

export const PRIVATE_NOTICE = "Fenêtre privée : l'assistant est désactivé tant que vous n'avez pas confirmé l'envoi pour cette fenêtre. Rien n'est conservé.";
