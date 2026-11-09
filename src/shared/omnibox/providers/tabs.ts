import { t } from "../../i18n";
import { recency } from "../scorer";
import type { OmniboxTab, Provider, QueryContext, Suggestion } from "../types";
import { matchedRow, present, shortUrl } from "./util";

/** Recent tabs listed before typing (unscoped). */
const RECENT_TABS = 6;

/** Open tabs of every space: "Aller à l'onglet" switches space if needed. */
export class TabsProvider implements Provider {
  readonly id = "tabs";
  readonly scope = "tabs" as const;

  query(text: string, context: QueryContext): Suggestion[] {
    let tabs: readonly OmniboxTab[] = context.tabs;
    if (!text) {
      // Before typing: the most recently used tabs, not the one on screen.
      tabs = [...tabs]
        .filter((tab) => context.scope || tab.id !== context.activeTabId)
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
        .slice(0, context.scope ? undefined : RECENT_TABS);
    }
    return present(
      tabs.map((tab) => {
        const elsewhere = tab.spaceId !== null && tab.spaceId !== context.activeSpaceId && tab.spaceName;
        const url = shortUrl(tab.url);
        return matchedRow(
          text,
          "tabs",
          {
            key: `tab:${tab.id}`,
            title: tab.title || url || t("providersTabs.newTab"),
            detail: elsewhere ? `${tab.spaceName} · ${url}` : url,
            icon: "tab",
            favicon: tab.favicon,
            verb: t("providersTabs.goTab"),
            completion: tab.url,
            action: { type: "tab", tabId: tab.id, spaceId: tab.spaceId },
          },
          { boost: recency(tab.lastActiveAt, context.now) * 0.5 },
        );
      }),
    );
  }
}
