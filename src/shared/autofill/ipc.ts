import type { AddressFields } from "./address";
import type { FieldSection } from "./classify";
import type { CardSummary, SavedAddress } from "./model";

/** What crosses IPC for autofill (ADR-041). A card number only through `AutofillRevealResult`. */

export interface AutofillStatus {
  available: boolean;
  /** Why saving is impossible (French), when not available. */
  message: string | null;
  /** Linux "basic" key store: weak protection, said in the settings. */
  weak: boolean;
}

export type AutofillResult = { ok: true } | { ok: false; message: string };
export type AutofillRevealResult = { ok: true; number: string } | { ok: false; message: string };

export interface AutofillList {
  addresses: SavedAddress[];
  cards: CardSummary[];
}

/** The save prompt after a submitted form: what would be saved (a card by its last digits). */
export interface AutofillPrompt {
  address: { summary: string; name: string; update: boolean } | null;
  card: (CardSummary & { update: boolean }) | null;
}

export type AutofillAnswer = "save" | "later";
export const isAutofillAnswer = (value: unknown): value is AutofillAnswer => value === "save" || value === "later";
export const isFieldSection = (value: unknown): value is FieldSection => value === "address" || value === "card";

/** The suggestion popover for a focused field. */
export interface AutofillSuggestions {
  site: string;
  section: FieldSection;
  addresses: { id: string; label: string; detail: string }[];
  cards: CardSummary[];
}

/** The address form of the settings (sanitized again in main). */
export type AddressInput = AddressFields;
