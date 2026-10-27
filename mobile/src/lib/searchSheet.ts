import { getCommand, type CommandContext, type CommandId } from "@shared/commands";
import { fuzzyMatch, type Range } from "@shared/fuzzy";
import { buildPalette, type PaletteItem, type PaletteSection, type RemoteTabInput } from "@shared/palette";
import { mergeSuggestions, rankHistory, topSites } from "@shared/search";
import { displayUrl } from "@shared/url";
import type { Bookmark, HistoryEntry, TabState } from "@shared/types";
import { normalizeInput, searchUrl, type SearchEngine } from "@shared/url";

/**
 * Content of the full-screen search sheet. It is the desktop command palette (`buildPalette`):
 * open tabs (fuzzy), bookmarks and history (frecency), actions from the shared command registry,
 * restricted to what makes sense on a phone, plus a few mobile-only actions.
 */

/** Shared commands offered on mobile (no windows, zoom, devtools, split view, zen mode…). */
export const MOBILE_COMMANDS: ReadonlySet<CommandId> = new Set<CommandId>([
  "new-tab",
  "close-tab",
  "duplicate-tab",
  "toggle-pin",
  "reload",
  "back",
  "forward",
  "copy-url",
  "toggle-bookmark",
  "clear-history",
  "open-settings",
  "new-space",
  "next-space",
  "previous-space",
  "sync-now",
  "site-info",
]);

export type MobileActionId = "share" | "new-private-tab" | "show-tabs";

export interface MobileAction {
  id: MobileActionId;
  label: string;
  keywords: readonly string[];
  icon: string;
  needsPage?: boolean;
}

export const MOBILE_ACTIONS: readonly MobileAction[] = [
  { id: "share", label: "Partager la page", keywords: ["share", "envoyer", "lien"], icon: "share", needsPage: true },
  { id: "new-private-tab", label: "Nouvel onglet privé", keywords: ["private", "incognito", "navigation privée"], icon: "mask" },
  { id: "show-tabs", label: "Afficher les onglets", keywords: ["tabs", "onglets ouverts", "aperçu"], icon: "tabs" },
];

export type SheetItem =
  | PaletteItem
  | {
      kind: "action";
      key: string;
      action: MobileAction;
      title: string;
      titleRanges: Range[];
      detail: string;
      detailRanges: Range[];
    };

export interface SheetSection {
  id: PaletteSection["id"];
  title: string | null;
  items: SheetItem[];
}

export interface SheetInput {
  query: string;
  tabs: readonly TabState[];
  activeTabId: string | null;
  history: readonly HistoryEntry[];
  bookmarks: readonly Bookmark[];
  engine: SearchEngine;
  context: CommandContext;
  now: number;
  /** Other devices' tabs (sync, ADR-019); left out in private browsing. */
  remoteTabs?: readonly RemoteTabInput[];
  /** Number of spaces: switching spaces is not offered with a single one. */
  spaceCount?: number;
  /** Private tab: no spaces, sync, history clearing nor "new private tab" (already private). */
  isPrivate?: boolean;
}

/** Commands never offered in private browsing (they concern the regular profile). */
const NOT_PRIVATE: ReadonlySet<string> = new Set(["new-space", "next-space", "previous-space", "sync-now", "clear-history", "new-private-tab"]);
/** Destructive commands: found by typing, not listed in the empty sheet. */
const DESTRUCTIVE: ReadonlySet<CommandId> = new Set<CommandId>(["close-tab", "clear-history"]);
const MAX_FREQUENT = 4;

/** Whether a command or mobile action fits the context (spaces, private browsing, empty query). */
function fits(id: string, input: SheetInput, empty: boolean): boolean {
  if (input.isPrivate && NOT_PRIVATE.has(id)) return false;
  if ((id === "next-space" || id === "previous-space") && (input.spaceCount ?? 1) < 2) return false;
  if (empty && DESTRUCTIVE.has(id as CommandId)) return false;
  return true;
}

const MAX_SUGGESTIONS = 8;

function mobileActionRows(query: string, context: CommandContext): { item: SheetItem; score: number }[] {
  const rows: { item: SheetItem; score: number }[] = [];
  for (const action of MOBILE_ACTIONS) {
    if (action.needsPage && !context.activeTab?.url) continue;
    const base = { kind: "action" as const, key: `action:${action.id}`, action, title: action.label, detail: "", detailRanges: [] };
    if (!query) {
      rows.push({ item: { ...base, titleRanges: [] }, score: 0 });
      continue;
    }
    const match = fuzzyMatch(query, action.label);
    if (match) rows.push({ item: { ...base, titleRanges: match.ranges }, score: match.score });
    else {
      const keyword = Math.max(...action.keywords.map((word) => fuzzyMatch(query, word)?.score ?? -Infinity));
      if (keyword > -Infinity) rows.push({ item: { ...base, titleRanges: [] }, score: keyword * 0.75 });
    }
  }
  return rows;
}

export function buildSheet(input: SheetInput): SheetSection[] {
  const text = input.query.trim();
  const ranked = text ? rankHistory(input.history, text, MAX_SUGGESTIONS * 2, input.now) : [];
  const suggestions = text ? mergeSuggestions(text, ranked, input.bookmarks, MAX_SUGGESTIONS) : [];
  const sections: SheetSection[] = buildPalette({
    query: text,
    tabs: input.tabs,
    activeTabId: input.activeTabId,
    suggestions,
    context: input.context,
    remoteTabs: input.remoteTabs,
  }).map((section) => ({
    ...section,
    items: section.items.filter((item) => item.kind !== "command" || (MOBILE_COMMANDS.has(item.command.id) && fits(item.command.id, input, !text))),
  }));

  // The shared palette searches with the default engine: use the one chosen in the settings.
  for (const section of sections) {
    if (section.id !== "web") continue;
    section.items = section.items.map((item) => (item.kind === "search" ? { ...item, url: searchUrl(text, input.engine) } : item));
  }
  if (text) {
    const go = sections.find((section) => section.id === "go");
    const url = normalizeInput(text, input.engine);
    if (go) go.items = go.items.map((item) => (item.kind === "navigate" ? { ...item, url } : item));
  }

  const extra = mobileActionRows(text, input.context)
    .filter((row) => row.item.kind !== "action" || fits(row.item.action.id, input, !text))
    .sort((a, b) => b.score - a.score);
  const commands = sections.find((section) => section.id === "commands");
  if (commands) {
    // Mobile actions first: they are the most useful ones on a phone.
    commands.items = text ? [...extra.map((row) => row.item), ...commands.items].slice(0, 7) : [...extra.map((row) => row.item), ...commands.items];
  } else if (extra.length) {
    const index = sections.findIndex((section) => section.id === "web");
    const section: SheetSection = { id: "commands", title: "Actions", items: extra.map((row) => row.item) };
    if (index === -1) sections.push(section);
    else sections.splice(index, 0, section);
  }
  // Before typing: the most visited sites come first (never in private browsing).
  if (!text && !input.isPrivate) {
    const open = new Set(input.tabs.map((tab) => tab.url));
    const frequent = topSites(input.history, MAX_FREQUENT * 2, input.now)
      .filter((entry) => !open.has(entry.url))
      .slice(0, MAX_FREQUENT)
      .map(
        (entry): SheetItem => ({
          kind: "history",
          key: `frequent:${entry.url}`,
          url: entry.url,
          favicon: entry.favicon,
          title: entry.title || displayUrl(entry.url),
          titleRanges: [],
          detail: displayUrl(entry.url),
          detailRanges: [],
        }),
      );
    if (frequent.length) sections.unshift({ id: "suggestions", title: "Sites fréquents", items: frequent });
  }
  return sections.filter((section) => section.items.length > 0);
}

/** Label for a shared command, as shown in the sheet. */
export const commandTitle = (id: CommandId) => getCommand(id).label;
