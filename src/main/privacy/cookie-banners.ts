import type { WebContents } from "electron";
import {
  COOKIE_BANNER_RULES,
  DEFAULT_AGENT_OPTIONS,
  bannerHideCss,
  cookieBannerAgent,
  sanitizeBannerResult,
  type BannerResult,
} from "@shared/cookie-banners";

/** Isolated worlds: 1001 cosmetics … 1017 assistant; 1020 cookie banners (1018-1019 left to ADR-047). */
export const COOKIE_BANNER_WORLD_ID = 1020;

/** Mutations closer than this are handled together: a busy page does not rerun the rules on each one. */
const MIN_WAIT_MS = 100;

/**
 * The page side of the agent's port (`BannerDom`), backed by the document. It only reads the DOM
 * and clicks; hiding is done by main (`insertCSS`, user origin), never with a node the page sees.
 */
const PAGE_PORT = `{
  query(list) {
    const one = (selector) => {
      const parts = selector.split(">>>").map((part) => part.trim());
      if (parts.length === 1) return Array.from(document.querySelectorAll(selector));
      const found = [];
      for (const host of document.querySelectorAll(parts[0])) if (host.shadowRoot) found.push(...host.shadowRoot.querySelectorAll(parts[1]));
      return found;
    };
    const found = [];
    for (const selector of list.split(",")) {
      try { if (selector.trim()) found.push(...one(selector.trim())); } catch (error) {}
    }
    return found;
  },
  visible(element) {
    if (!element.isConnected || !element.getClientRects().length) return false;
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
  },
  label(element) {
    return String(element.innerText || element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || element.value || "").trim().slice(0, 200);
  },
  click(element) { element.click(); },
  hide() {},
  changed(ms) {
    return new Promise((resolve) => {
      const start = Date.now();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve();
      };
      const observer = new MutationObserver(() => setTimeout(finish, Math.max(0, ${MIN_WAIT_MS} - (Date.now() - start))));
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "open"] });
      const timer = setTimeout(finish, ms);
    });
  },
  now() { return Date.now(); },
}`;

/**
 * Runs once per document in the isolated world (the same promise is returned if asked again).
 * The agent's own source is sent as text: it is self-contained by design (see its module).
 */
const AGENT_SCRIPT = `(globalThis.__browserCookieBanners || (globalThis.__browserCookieBanners = (${String(cookieBannerAgent)})(${JSON.stringify(
  COOKIE_BANNER_RULES,
)}, ${PAGE_PORT}, ${JSON.stringify(DEFAULT_AGENT_OPTIONS)})))`;

export interface CookieBannerDeps {
  /** Whether banners are handled on this page (setting on, site not an exception, shields on). */
  enabled(url: string): boolean;
  /** A banner was dealt with on `url` (refused or hidden). */
  handled(url: string, result: BannerResult): void;
}

/**
 * Cookie banners of one tab page (ADR-046): at `dom-ready`, the agent looks for a known CMP and
 * refuses it, watching the page for a late banner for a bounded time. Main frame only (a CMP in a
 * cross-origin frame is out of reach).
 */
export class TabCookieBanners {
  private generation = 0;

  constructor(
    private readonly contents: WebContents,
    private readonly deps: CookieBannerDeps,
  ) {
    contents.on("did-navigate", () => this.generation++);
    contents.on("dom-ready", () => void this.run());
  }

  private async run(): Promise<void> {
    const url = this.contents.getURL();
    if (!/^https?:/i.test(url) || !this.deps.enabled(url)) return;
    const generation = this.generation;
    let result: BannerResult | null;
    try {
      result = sanitizeBannerResult(await this.contents.executeJavaScriptInIsolatedWorld(COOKIE_BANNER_WORLD_ID, [{ code: AGENT_SCRIPT }]));
    } catch {
      return; // Page gone or navigating.
    }
    if (!result || generation !== this.generation || this.contents.isDestroyed()) return;
    if (result.outcome === "hidden" && result.cmp) {
      const css = bannerHideCss(result.cmp);
      if (css) await this.contents.insertCSS(css, { cssOrigin: "user" }).catch(() => {});
    }
    if (result.outcome === "rejected" || result.outcome === "hidden") this.deps.handled(url, result);
  }
}
