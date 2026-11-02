import type { ArchivedTab } from "../archive";
import type { CommandContext, CommandDefinition, CommandId } from "../commands";
import type { Range } from "../fuzzy";
import type { Bookmark, FavoriteTile, HistoryEntry, SpaceId, TabId } from "../types";
import type { SearchEngine } from "../url";
import type { SettingEntry } from "./settings-index";

/**
 * The universal bar (ADR-032): one input, results from independent providers, ranked by a pure
 * scorer. Desktop (overlay) and phone (search sheet) share every type and provider here.
 */

/** Result groups, in the order the scorer may show them (see `scorer.ts` for the ranking). */
export type SectionId =
  | "scopes"
  | "answer"
  | "go"
  | "tabs"
  | "favorites"
  | "bookmarks"
  | "history"
  | "commands"
  | "settings"
  | "remote"
  | "archived"
  | "web";

/** Prefix scopes (`@onglets`, `@o`…): restrict the bar to some providers. */
export type ScopeId = "tabs" | "favorites" | "history" | "commands" | "settings";

/** Semantic icons; each UI maps them to its own Lucide component (commands use their `icon`). */
export type OmniboxIcon =
  | "search"
  | "globe"
  | "calculator"
  | "ruler"
  | "clock"
  | "binary"
  | "star"
  | "bookmark"
  | "history"
  | "settings"
  | "cloud"
  | "archive"
  | "tab"
  | "command"
  | "at";

/** What choosing a suggestion does. Each UI performs it with its own APIs. */
export type SuggestionAction =
  /** Shows an open tab, switching space if needed. */
  | { type: "tab"; tabId: TabId; spaceId: SpaceId | null }
  /** Loads a page (history, bookmark, remote tab, typed address, search, settings deep link). */
  | { type: "open"; url: string }
  /** Shows the favorite's tab, or opens it. */
  | { type: "favorite"; url: string }
  | { type: "command"; command: CommandDefinition }
  /** Instant answer: Enter copies `text`. */
  | { type: "copy"; text: string }
  | { type: "archived"; archiveId: string; url: string }
  /** Sets the prefix scope (chip). */
  | { type: "scope"; scope: ScopeId }
  /** Platform-specific actions (mobile share…), defined by the platform's own providers. */
  | { type: "custom"; id: string };

export interface Suggestion {
  /** Stable across keystrokes (keyed lists). */
  key: string;
  section: SectionId;
  title: string;
  titleRanges: Range[];
  /** Secondary text (URL, space, unit…), may be empty. */
  detail: string;
  detailRanges: Range[];
  /** Higher is better; comparable across providers (see `scorer.ts`). */
  score: number;
  icon: OmniboxIcon;
  /** Site icon (data: URL) when known: shown instead of `icon`. */
  favicon?: string | null;
  /** Keys of the effective shortcut (commands). */
  shortcut?: string[];
  /** What Tab puts in the input. */
  completion?: string;
  /** Hint shown on the selected row ("Aller à l'onglet", "Copier"…). */
  verb: string;
  action: SuggestionAction;
}

/** A tab of any space of the window. */
export interface OmniboxTab {
  id: TabId;
  title: string;
  url: string;
  favicon: string | null;
  lastActiveAt: number;
  isLoading?: boolean;
  spaceId: SpaceId | null;
  /** Shown when the tab is not in the space on screen. */
  spaceName?: string;
}

export interface RemoteTabInput {
  device: string;
  url: string;
  title: string;
}

/** Everything providers read. Snapshots: the UI rebuilds it when its sources change. */
export interface OmniboxData {
  tabs: readonly OmniboxTab[];
  activeTabId: TabId | null;
  /** The space on screen: its tabs need no space label. */
  activeSpaceId: SpaceId | null;
  favorites: readonly Pick<FavoriteTile, "url" | "title" | "favicon">[];
  bookmarks: readonly Bookmark[];
  /** History matching the current text, best first (ranked by main or `rankHistory`). */
  history: readonly Pick<HistoryEntry, "url" | "title" | "favicon">[];
  remoteTabs: readonly RemoteTabInput[];
  archived: readonly ArchivedTab[];
  commandContext: CommandContext;
  /** Effective shortcut keys of a command (ADR-028); none on the phone. */
  shortcut?: (id: CommandId) => string[];
  /** Platform filter on commands (`empty`: nothing typed yet). Default: every available command. */
  commandFilter?: (command: CommandDefinition, empty: boolean) => boolean;
  settings: readonly SettingEntry[];
  engine: SearchEngine;
  /** Epoch ms, for time zones. */
  now: number;
}

export interface QueryContext extends OmniboxData {
  scope: ScopeId | null;
}

/** A source of suggestions. Pure: same text and context, same result. */
export interface Provider {
  readonly id: string;
  /** The scope that keeps this provider (none: only unscoped queries). */
  readonly scope?: ScopeId;
  query(text: string, context: QueryContext): Suggestion[];
}

export interface Section {
  id: SectionId;
  /** Null for sections without a header (the answer, the typed address). */
  title: string | null;
  items: Suggestion[];
}

export interface OmniboxResult {
  scope: ScopeId | null;
  /** Text after the scope prefix. */
  text: string;
  sections: Section[];
  /** Flat list, in display order (keyboard selection). */
  items: Suggestion[];
}

/** Where a page opens: Enter, Ctrl+Enter, Alt+Enter, Shift+Enter. */
export const OPEN_DISPOSITIONS = ["current", "new", "background", "split"] as const;
export type OpenDisposition = (typeof OPEN_DISPOSITIONS)[number];

/** Longest text the bar copies (instant answers are short). */
export const MAX_COPY_LENGTH = 1024;
