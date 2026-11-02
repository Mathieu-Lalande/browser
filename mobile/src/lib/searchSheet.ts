import { type CommandContext, type CommandDefinition, type CommandId } from "@shared/commands";
import { Omnibox, sharedProviders } from "@shared/omnibox/omnibox";
import { matchedRow, present } from "@shared/omnibox/providers/util";
import type { OmniboxIcon, Provider, QueryContext, RemoteTabInput, ScopeId, Section, Suggestion } from "@shared/omnibox/types";
import { rankHistory, topSites } from "@shared/search";
import { displayUrl, type SearchEngine } from "@shared/url";
import type { Bookmark, HistoryEntry, TabState } from "@shared/types";

/**
 * Content of the full-screen search sheet: the desktop's universal bar (ADR-032), same providers,
 * scorer, scopes and instant answers (`@shared/omnibox`), restricted to what makes sense on a
 * phone, plus a few mobile-only actions (a provider of their own). No settings deep links: the
 * phone's settings screen has its own layout.
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

export const mobileAction = (id: string) => MOBILE_ACTIONS.find((action) => action.id === id);

export type SheetItem = Suggestion;
export type SheetSection = Section;

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
  /** A scope chip chosen from the scope rows. */
  scope?: ScopeId | null;
}

/** Commands never offered in private browsing (they concern the regular profile). */
const NOT_PRIVATE: ReadonlySet<string> = new Set(["new-space", "next-space", "previous-space", "sync-now", "clear-history", "new-private-tab"]);
/** Destructive commands: found by typing, not listed in the empty sheet. */
const DESTRUCTIVE: ReadonlySet<string> = new Set<CommandId>(["close-tab", "clear-history"]);
const MAX_FREQUENT = 4;
const MAX_HISTORY = 16;

/** Whether a command or mobile action fits the context (spaces, private browsing, empty query). */
function fits(id: string, input: SheetInput, empty: boolean): boolean {
  if (input.isPrivate && NOT_PRIVATE.has(id)) return false;
  if ((id === "next-space" || id === "previous-space") && (input.spaceCount ?? 1) < 2) return false;
  if (empty && DESTRUCTIVE.has(id)) return false;
  return true;
}

/** Mobile-only actions, ranked with the commands (they come first on a tie: the most useful on a phone). */
class MobileActionsProvider implements Provider {
  readonly id = "mobile-actions";
  readonly scope = "commands" as const;

  constructor(private readonly input: SheetInput) {}

  query(text: string, context: QueryContext): Suggestion[] {
    const actions = MOBILE_ACTIONS.filter((action) => (!action.needsPage || context.commandContext.activeTab?.url) && fits(action.id, this.input, !text));
    return present(
      actions.map((action) =>
        matchedRow(
          text,
          "commands",
          {
            key: `action:${action.id}`,
            title: action.label,
            detail: "",
            icon: "command" as OmniboxIcon,
            verb: "Exécuter",
            completion: action.label,
            action: { type: "custom", id: action.id },
          },
          { keywords: action.keywords, boost: 0.01 },
        ),
      ),
    );
  }
}

export function buildSheet(input: SheetInput): SheetSection[] {
  const text = input.query.trim();
  const omnibox = new Omnibox([new MobileActionsProvider(input), ...sharedProviders()]);
  const filter = (command: CommandDefinition, empty: boolean) => MOBILE_COMMANDS.has(command.id) && fits(command.id, input, empty);
  const result = omnibox.query(
    text,
    {
      tabs: input.tabs.map((tab) => ({ ...tab, spaceId: null })),
      activeTabId: input.activeTabId,
      activeSpaceId: null,
      favorites: [],
      bookmarks: input.bookmarks,
      history: text ? rankHistory(input.history, text.replace(/^@\S+\s+/, ""), MAX_HISTORY, input.now) : [],
      remoteTabs: input.remoteTabs ?? [],
      archived: [],
      commandContext: input.context,
      commandFilter: filter,
      settings: [],
      engine: input.engine,
      now: input.now,
    },
    input.scope ?? null,
  );
  const sections = [...result.sections];
  // Before typing: the most visited sites come first (never in private browsing).
  if (!text && !input.scope && !input.isPrivate) {
    const open = new Set(input.tabs.map((tab) => tab.url));
    const frequent = topSites(input.history, MAX_FREQUENT * 2, input.now)
      .filter((entry) => !open.has(entry.url))
      .slice(0, MAX_FREQUENT)
      .map(
        (entry): SheetItem => ({
          key: `frequent:${entry.url}`,
          section: "history",
          title: entry.title || displayUrl(entry.url),
          titleRanges: [],
          detail: displayUrl(entry.url),
          detailRanges: [],
          score: 0,
          icon: "history",
          favicon: entry.favicon,
          verb: "Ouvrir",
          completion: entry.url,
          action: { type: "open", url: entry.url },
        }),
      );
    if (frequent.length) sections.unshift({ id: "history", title: "Sites fréquents", items: frequent });
  }
  return sections;
}

/** The URL a row opens, if it opens one (for the site icon and the "edit address" button). */
export function itemUrl(item: SheetItem): string | null {
  const { action } = item;
  if (action.type === "open" || action.type === "favorite") return action.url;
  return null;
}
