import type { PanelView } from "@shared/panels";
import { api, browser } from "./browser.svelte";

/**
 * The web panels as the chrome UI sees them (ADR-047): the list and the open panel come from main
 * with the window state; the "add a panel" form beside the page is this UI's own state.
 */
class PanelsUi {
  /** The "+" form is shown in the panel area (no panel page meanwhile). */
  adding = $state(false);

  get list(): PanelView[] {
    return browser.state.panels?.panels ?? [];
  }

  /** The panel shown beside the page, if any. */
  get open(): PanelView | null {
    const id = browser.state.panels?.openId;
    return (id && this.list.find((panel) => panel.id === id)) || null;
  }

  /** Panels exist in normal windows only (ADR-014). */
  get available(): boolean {
    return !browser.isPrivate && !!browser.state.panels;
  }

  toggle(id: string): void {
    this.adding = false;
    api.panels.toggle(id);
  }

  startAdding(): void {
    if (!this.available) return;
    if (this.open) api.panels.close();
    this.adding = !this.adding;
  }

  async add(url: string, title?: string, mobile?: boolean): Promise<string | null> {
    const result = await api.panels.add(url, title, mobile);
    if (!result.ok) return result.message;
    this.adding = false;
    api.panels.toggle(result.panel.id);
    return null;
  }
}

export const panelsUi = new PanelsUi();
