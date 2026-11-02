import { clipboard } from "electron";
import { internalFragment, internalPageOf } from "@shared/internal";
import type { OmniboxTab, OpenDisposition } from "@shared/omnibox/types";
import type { BrowserController } from "./window";

/** Main side of the universal bar (ADR-032): every space's tabs, opening pages, copying answers. */

/** Tabs of every space of the window (the shown space first), with their space's name. */
export function omniboxTabs(c: BrowserController): OmniboxTab[] {
  const names = new Map(c.getState().spaces.map((space) => [space.id, space.name]));
  return c.spaces.allTabs().map(({ spaceId, tab }) => ({
    id: tab.id,
    title: tab.title,
    url: tab.url,
    favicon: tab.favicon,
    lastActiveAt: tab.lastActiveAt,
    isLoading: tab.isLoading,
    spaceId,
    spaceName: names.get(spaceId),
  }));
}

/** Opens what the user chose or typed, where the keys asked. Internal pages reuse their tab. */
export function omniboxOpen(c: BrowserController, input: string, disposition: OpenDisposition): void {
  const page = internalPageOf(input);
  if (disposition === "current" && page) {
    c.openInternal(page, internalFragment(input));
    return;
  }
  const active = c.tabs.activeTabId;
  if (disposition === "current" && active) {
    c.tabs.navigate(active, input);
    return;
  }
  const id = c.tabs.create(input, { activate: disposition === "current" || disposition === "new" });
  if (disposition === "split") c.tabs.openSplit(id);
}

export function omniboxCopy(text: string): void {
  clipboard.writeText(text);
}
