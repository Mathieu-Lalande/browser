import { getLocale, t } from "@shared/i18n";
import { groupLocally, parseTidyAnswer, TIDY_SCHEMA, tidyPrompt, type TidyProposal, type TidyScope, type TidyTab } from "@shared/tab-tidy";
import { errorMessage, structuredAnswer } from "./assistant/client";
import { assistantKey } from "./assistant/keys";
import { settings } from "./settings";
import { showsWebPage } from "./tabs/model";
import type { TabPort } from "./ports";

/**
 * "Ranger les onglets" (ADR-059): proposes folders for the tabs of the window's space: the loose
 * ones (not pinned, not in a folder), or with `scope` "all" every unpinned one (a full
 * reorganization). The assistant names topics when it is on with a key and the window is not
 * private (titles of a private window never leave the device); otherwise tabs are grouped on
 * this device (shared words of their titles, then sites). Nothing moves here: the UI shows the
 * proposal and creates the folders the user keeps.
 */

const TIMEOUT_MS = 30_000;

function candidates(tabs: TabPort, scope: TidyScope): { chosen: TidyTab[]; inFolders: number } {
  const web = tabs.getState().tabs.filter((tab) => !tab.isPinned && showsWebPage(tab.url));
  const chosen = web.filter((tab) => scope === "all" || !tab.folderId).map((tab) => ({ id: tab.id, title: tab.title, url: tab.url }));
  return { chosen, inFolders: scope === "all" ? 0 : web.filter((tab) => tab.folderId).length };
}

export async function proposeTidy(tabs: TabPort, isPrivate: boolean, scope: TidyScope = "loose"): Promise<TidyProposal> {
  const { chosen, inFolders } = candidates(tabs, scope);
  const current = settings().assistant;
  const key = assistantKey.get();
  const assistantReady = !isPrivate && current.enabled && current.acknowledged && !!key;
  const local = (notice?: string): TidyProposal => ({ source: "local", scope, groups: groupLocally(chosen), considered: chosen.length, inFolders, assistantReady, notice });
  if (!assistantReady || chosen.length < 2) return local();
  try {
    const text = await structuredAnswer(key, current.model, tidyPrompt(chosen, getLocale()), TIDY_SCHEMA, AbortSignal.timeout(TIMEOUT_MS));
    const groups = parseTidyAnswer(text, chosen);
    if (groups.length) return { source: "ai", scope, groups, considered: chosen.length, inFolders, assistantReady };
    return local(t("tabTidy.noTopicsFound"));
  } catch (error) {
    return local(errorMessage(error));
  }
}
