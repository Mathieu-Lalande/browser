import { fold } from "../fuzzy";
import type { OmniboxIcon, ScopeId } from "./types";

/** Prefix scopes of the universal bar: `@onglets zoom` or `@o zoom` searches open tabs only. */

export interface ScopeDefinition {
  id: ScopeId;
  /** Chip label. */
  label: string;
  /** Full prefix (without `@`), then its short form and accepted spellings. */
  names: readonly string[];
  icon: OmniboxIcon;
}

export const SCOPES: readonly ScopeDefinition[] = [
  { id: "tabs", label: "Onglets", names: ["onglets", "o", "onglet", "tabs"], icon: "tab" },
  { id: "favorites", label: "Favoris", names: ["favoris", "f", "favori", "bookmarks"], icon: "star" },
  { id: "history", label: "Historique", names: ["historique", "h", "history"], icon: "history" },
  { id: "commands", label: "Commandes", names: ["commandes", "c", "commande", "actions"], icon: "command" },
  { id: "notes", label: "Notes", names: ["notes", "n", "note", "annotations", "surlignages"], icon: "highlighter" },
  { id: "settings", label: "Réglages", names: ["réglages", "r", "reglages", "paramètres", "parametres", "settings"], icon: "settings" },
];

export const scopeById = (id: ScopeId): ScopeDefinition => SCOPES.find((scope) => scope.id === id)!;

/** The scope named exactly (accents and case ignored), if any. */
export function scopeNamed(name: string): ScopeId | null {
  const folded = fold(name);
  return SCOPES.find((scope) => scope.names.some((candidate) => fold(candidate) === folded))?.id ?? null;
}

export interface ParsedInput {
  /** A complete scope prefix followed by a space (or the whole input). */
  scope: ScopeId | null;
  /** The text to search, without the prefix. */
  text: string;
  /** `@` + letters still being typed (no space yet): the bar offers matching scopes. */
  pending: string | null;
}

/**
 * Splits a leading `@scope ` off the input. "@r zoom" → settings, "zoom"; "@ré" → pending "ré"
 * (completed by Tab or the scope rows); "@inconnu x" stays plain text.
 */
export function parseScope(input: string): ParsedInput {
  const match = /^@(\S*)(\s+([\s\S]*))?$/.exec(input.trimStart());
  if (!match) return { scope: null, text: input, pending: null };
  const [, name, space, rest] = match;
  if (space === undefined) return { scope: null, text: input, pending: name };
  const scope = scopeNamed(name);
  return scope ? { scope, text: rest ?? "", pending: null } : { scope: null, text: input, pending: null };
}

/** Scopes whose full name starts with `prefix` ("" lists them all). */
export function scopesMatching(prefix: string): ScopeDefinition[] {
  const folded = fold(prefix);
  return SCOPES.filter((scope) => scope.names.some((name) => fold(name).startsWith(folded)));
}
