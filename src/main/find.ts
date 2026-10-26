import type { WebContents } from "electron";
import type { FindState } from "@shared/types";

const MAX_QUERY = 1000;

/**
 * Find in page for one tab (Chromium's own find: `findInPage` / `found-in-page`). The chrome UI
 * draws the bar as a strip above the page (ADR-013) and sends the query; results come back here
 * and are mirrored in the tab state ("3/17"). The query stays with the tab when the bar closes.
 */
export class PageFind {
  private state: FindState | null = null;
  /** Latest request: results of older ones (typing fast) are ignored. */
  private requestId = 0;
  /** A new page started loading since the last search. */
  private stale = false;

  constructor(
    private readonly contents: WebContents,
    private readonly onChange: (state: FindState | null) => void,
  ) {
    contents.on("found-in-page", (_event, result) => {
      if (!this.state || result.requestId !== this.requestId) return;
      this.set({
        matches: result.matches ?? this.state.matches,
        activeMatch: result.activeMatchOrdinal ?? this.state.activeMatch,
      });
    });
    contents.on("did-start-navigation", (details) => {
      if (!details.isMainFrame || details.isSameDocument || !this.state) return;
      this.requestId = 0;
      this.stale = true;
      this.set({ matches: 0, activeMatch: 0 });
    });
    // A new page loaded while the bar is open: search it too.
    contents.on("did-stop-loading", () => {
      if (!this.stale) return;
      this.stale = false;
      if (this.state?.open && this.state.query) this.search(this.state.query, this.state.matchCase);
    });
  }

  /** Shows the bar (with the tab's last query, searched again). */
  open(): void {
    this.set({ open: true });
    if (this.state?.query) this.search(this.state.query, this.state.matchCase);
  }

  /** A new search from the first match (typing, or the case toggle). */
  search(query: string, matchCase: boolean): void {
    const text = query.slice(0, MAX_QUERY);
    this.set({ query: text, matchCase, open: true });
    if (!text) {
      this.requestId = 0;
      this.contents.stopFindInPage("clearSelection");
      this.set({ matches: 0, activeMatch: 0 });
      return;
    }
    this.requestId = this.contents.findInPage(text, { matchCase, findNext: true });
  }

  /** Next or previous match (Enter / Shift+Enter, F3 / Shift+F3) while the bar is open. */
  step(forward: boolean): void {
    if (!this.state?.open || !this.state.query) return;
    this.requestId = this.contents.findInPage(this.state.query, { matchCase: this.state.matchCase, forward, findNext: false });
  }

  /** Hides the bar and the highlights; the active match stays selected, like in other browsers. */
  close(): void {
    if (!this.state?.open) return;
    this.requestId = 0;
    if (!this.contents.isDestroyed()) this.contents.stopFindInPage("keepSelection");
    this.set({ open: false, matches: 0, activeMatch: 0 });
  }

  private set(patch: Partial<FindState>): void {
    this.state = { open: false, query: "", matchCase: false, matches: 0, activeMatch: 0, ...this.state, ...patch };
    this.onChange(this.state);
  }
}
