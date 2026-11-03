import { CalculatorProvider, ConversionProvider, NumberBaseProvider, TimeZoneProvider } from "./providers/answers";
import { CommandsProvider, SettingsProvider } from "./providers/commands";
import { AnnotationsProvider, ArchivedTabsProvider, BookmarksProvider, FavoritesProvider, HistoryProvider, RemoteTabsProvider } from "./providers/pages";
import { TabsProvider } from "./providers/tabs";
import { WebProvider } from "./providers/web";
import { rank, SCOPED_LIMIT } from "./scorer";
import { parseScope, scopesMatching } from "./scopes";
import type { OmniboxData, OmniboxResult, Provider, ScopeId, Section, Suggestion } from "./types";

/** Section titles before anything is typed. */
const EMPTY_TITLES: Partial<Record<Section["id"], string>> = { tabs: "Onglets récents" };

/** Before typing, every action is listed (browsing them is how users discover them). */
const EMPTY_LIMITS = { commands: SCOPED_LIMIT };

/**
 * The universal bar's engine: asks every provider (or the scoped ones), then ranks. Stateless:
 * the UI calls `query` on every keystroke with fresh data.
 */
export class Omnibox {
  constructor(private readonly providers: readonly Provider[]) {}

  /**
   * Results for `input`. `scope` is the chip already chosen; otherwise a leading `@scope ` in the
   * input sets it, and a bare `@sco` lists the matching scopes.
   */
  query(input: string, data: OmniboxData, chosen: ScopeId | null = null): OmniboxResult {
    const parsed = chosen ? { scope: chosen, text: input, pending: null } : parseScope(input);
    if (parsed.pending !== null) {
      const scopes = scopesMatching(parsed.pending).map(
        (scope, index): Suggestion => ({
          key: `scope:${scope.id}`,
          section: "scopes",
          title: `@${scope.names[0]}`,
          titleRanges: [[0, 1 + parsed.pending!.length]],
          detail: `${scope.label} · @${scope.names[1]}`,
          detailRanges: [],
          score: -index,
          icon: scope.icon,
          verb: "Filtrer",
          completion: `@${scope.names[0]} `,
          action: { type: "scope", scope: scope.id },
        }),
      );
      if (scopes.length) return this.result(null, input, rank(scopes));
    }
    const { scope } = parsed;
    const text = parsed.text.trim();
    const context = { ...data, scope };
    const providers = scope ? this.providers.filter((provider) => provider.scope === scope) : this.providers;
    const suggestions = providers.flatMap((provider) => provider.query(text, context));
    const empty = !text;
    const sections = rank(suggestions, { scoped: scope !== null, keepOrder: empty, limits: empty ? EMPTY_LIMITS : undefined }).map((section) =>
      empty && !scope && EMPTY_TITLES[section.id] ? { ...section, title: EMPTY_TITLES[section.id]! } : section,
    );
    return this.result(scope, text, sections);
  }

  private result(scope: ScopeId | null, text: string, sections: Section[]): OmniboxResult {
    return { scope, text, sections, items: sections.flatMap((section) => section.items) };
  }
}

/** Providers shared by the desktop bar and the phone's search sheet, in empty-state order. */
export function sharedProviders(): Provider[] {
  return [
    new CalculatorProvider(),
    new ConversionProvider(),
    new TimeZoneProvider(),
    new NumberBaseProvider(),
    new WebProvider(),
    new TabsProvider(),
    new FavoritesProvider(),
    new BookmarksProvider(),
    new HistoryProvider(),
    new RemoteTabsProvider(),
    new ArchivedTabsProvider(),
    new AnnotationsProvider(),
    new CommandsProvider(),
    new SettingsProvider(),
  ];
}
