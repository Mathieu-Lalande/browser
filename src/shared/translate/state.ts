import type { TranslateProviderChoice, TranslateProviderId } from "./providers";

/** What the UIs show about a tab's translation (ADR-036). */

export type TranslationStatus = "idle" | "translating" | "translated" | "error";

export interface TabTranslation {
  /** The page's declared language (null: none, the provider detects it). */
  pageLanguage: string | null;
  /** The source used or detected by the provider once translated. */
  from: string | null;
  to: string;
  status: TranslationStatus;
  /** The address bar offers translation (the page's language differs from the target). */
  offer: boolean;
  /** French message of the last failure. */
  error?: string;
}

/** The translate popover's content for a tab. */
export interface TranslatePanelState {
  site: string | null;
  translation: TabTranslation;
  provider: TranslateProviderChoice;
  /** The provider's credentials are set (key, or server URL). */
  configured: boolean;
  /** The privacy notice must be accepted first (normal windows: once; private windows: each session). */
  needsConsent: boolean;
  isPrivate: boolean;
  /** "Toujours traduire <langue de la page>" is on. */
  alwaysLanguage: boolean;
  /** "Jamais pour ce site" is on. */
  neverSite: boolean;
}

/** Which API keys are stored (the keys themselves never reach the UI). */
export interface TranslateKeysStatus {
  /** OS encryption is available: keys can be saved. */
  available: boolean;
  message: string | null;
  keys: Record<TranslateProviderId, boolean>;
}

export type TranslateResultMessage = { ok: true; message: string } | { ok: false; message: string };

/** One rule change from the popover. */
export type TranslateRuleChange = "always-language" | "never-site";
export const isTranslateRuleChange = (value: unknown): value is TranslateRuleChange => value === "always-language" || value === "never-site";
