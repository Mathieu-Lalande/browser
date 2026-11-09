import { t, keywords } from "../i18n";
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
  { id: "tabs", get label() { return t("omniboxScopes.tabs") }, get names() { return keywords("omniboxScopes.tabsKeywords") }, icon: "tab" },
  { id: "favorites", get label() { return t("omniboxScopes.bookmarks") }, get names() { return keywords("omniboxScopes.bookmarksKeywords") }, icon: "star" },
  { id: "history", get label() { return t("omniboxScopes.history") }, names: ["historique", "h", "history"], icon: "history" },
  { id: "commands", get label() { return t("omniboxScopes.commands") }, names: ["commandes", "c", "commande", "actions"], icon: "command" },
  { id: "notes", get label() { return t("omniboxScopes.notes") }, names: ["notes", "n", "note", "annotations", "surlignages"], icon: "highlighter" },
  { id: "assistant", get label() { return t("omniboxScopes.aiAssistant") }, names: ["ia", "assistant", "ai", "claude"], icon: "sparkles" },
  { id: "settings", get label() { return t("omniboxScopes.settings") }, get names() { return keywords("omniboxScopes.settingsKeywords") }, icon: "settings" },
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
