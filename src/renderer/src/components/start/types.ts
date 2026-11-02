import type { StartWidgetOf, WidgetKind } from "@shared/start-widgets";
import { api, browser } from "../../lib/browser.svelte";
import type { StartLayout } from "./layout.svelte";

/** What every widget component receives. */
export interface WidgetProps<K extends WidgetKind> {
  widget: StartWidgetOf<K>;
  layout: StartLayout;
  /** Edit mode: the content is inert (the card is being moved or set up). */
  editing: boolean;
}

/** Opens a URL in the start page's own tab. */
export function openHere(url: string): void {
  const id = browser.state.activeTabId;
  if (id) api.tabs.navigate(id, url);
}
