import { t } from "@shared/i18n";
import { incomingPageUrl } from "./incomingUrl";

/**
 * Ways into the app from the home screen (ADR-055): quick actions (long press on the icon:
 * New tab, Private tab, Search; `expo-quick-actions`) and the system share sheet ("Browser" as a
 * share target, `expo-share-intent`: Android SEND intent, iOS share extension).
 */

export type LaunchAction = "new-tab" | "private-tab" | "search";
const ACTIONS: readonly LaunchAction[] = ["new-tab", "private-tab", "search"];

/** iOS system icons (the home screen menu is drawn by the system; Android shows the titles only). */
const IOS_ICONS: Record<LaunchAction, string> = { "new-tab": "add", "private-tab": "prohibit", search: "search" };

export function quickActionItems(platform: string): { id: LaunchAction; title: string; icon: string | null }[] {
  const titles: Record<LaunchAction, string> = {
    "new-tab": t("mobile.launchActions.newTab"),
    "private-tab": t("mobile.launchActions.privateTab"),
    search: t("mobile.launchActions.search"),
  };
  return ACTIONS.map((id) => ({ id, title: titles[id], icon: platform === "ios" ? IOS_ICONS[id] : null }));
}

export function parseQuickAction(action: { id?: unknown } | null | undefined): LaunchAction | null {
  const id = action?.id;
  return typeof id === "string" && (ACTIONS as readonly string[]).includes(id) ? (id as LaunchAction) : null;
}

/** Longest shared text turned into a search. */
export const MAX_SHARED_TEXT = 1000;

/**
 * What a share opens: the link (the one the sender marked, else the first http(s) URL in the
 * text), else a search for the text; null for nothing usable (files, empty text).
 */
export function sharedContentTarget(share: { webUrl?: string | null; text?: string | null } | null | undefined): { kind: "url"; url: string } | { kind: "search"; text: string } | null {
  if (!share) return null;
  const direct = incomingPageUrl(share.webUrl ?? null, "");
  if (direct) return { kind: "url", url: direct };
  // eslint-disable-next-line no-control-regex
  const text = (share.text ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (!text) return null;
  for (const candidate of text.match(/https?:\/\/[^\s<>"]+/gi) ?? []) {
    const url = incomingPageUrl(candidate.replace(/[),.;:!?»]+$/, ""), "");
    if (url) return { kind: "url", url };
  }
  return { kind: "search", text: text.replace(/\s+/g, " ").slice(0, MAX_SHARED_TEXT) };
}
