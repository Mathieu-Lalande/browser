import type { WebContents } from "electron";
import type { ContentBlocker, DomFeatures } from "./blocker";

/** Isolated world used for the DOM scan: the page cannot see nor tamper with it. */
const SCAN_WORLD_ID = 1001;
const MAX_FEATURES = 20_000;

/**
 * Read-only scan of the page's class names, ids and link targets (the same features Ghostery's
 * content script collects). Runs once per call, in an isolated world; nothing stays in the page.
 */
const SCAN_SCRIPT = `(() => {
  const ignored = new Set(["br", "head", "link", "meta", "script", "style", "s"]);
  const classes = new Set(), ids = new Set(), hrefs = new Set();
  for (const el of document.querySelectorAll("[id]:not(html):not(body),[class]:not(html):not(body),[href]:not(html):not(body)")) {
    if (ignored.has(el.localName)) continue;
    const id = el.getAttribute("id");
    if (id) ids.add(id);
    for (const name of el.classList) classes.add(name);
    const href = el.getAttribute("href");
    if (href) hrefs.add(href);
    if (classes.size + ids.size + hrefs.size > ${MAX_FEATURES}) break;
  }
  return { classes: [...classes], ids: [...ids], hrefs: [...hrefs] };
})()`;

/**
 * Cosmetic filtering without a preload (ADR-005): main pushes element-hiding CSS (user origin, so it
 * beats the page's styles) when the page commits, then again after scanning the DOM when it is
 * parsed and when it finishes loading. Elements added later by scripts are not rescanned.
 */
export class TabCosmetics {
  private generation = 0;
  private seen = { classes: new Set<string>(), ids: new Set<string>(), hrefs: new Set<string>() };

  constructor(
    private readonly contents: WebContents,
    private readonly blocker: ContentBlocker,
    private readonly isEnabled: (url: string) => boolean,
  ) {
    contents.on("did-navigate", (_event, url) => this.committed(url));
    contents.on("dom-ready", () => void this.scan());
    contents.on("did-stop-loading", () => void this.scan());
  }

  private committed(url: string): void {
    this.generation++;
    this.seen = { classes: new Set(), ids: new Set(), hrefs: new Set() };
    if (this.isEnabled(url)) this.insert(this.blocker.cosmeticStyles(url));
  }

  private async scan(): Promise<void> {
    const url = this.contents.getURL();
    if (!this.isEnabled(url)) return;
    const generation = this.generation;
    let features: DomFeatures;
    try {
      features = await this.contents.executeJavaScriptInIsolatedWorld(SCAN_WORLD_ID, [{ code: SCAN_SCRIPT }]);
    } catch {
      return; // Page gone or navigating.
    }
    // The page changed while scanning: these features belong to the previous document.
    if (generation !== this.generation || this.contents.isDestroyed()) return;
    const fresh = (values: string[], seen: Set<string>) => values.filter((value) => !seen.has(value) && seen.add(value));
    const dom: DomFeatures = {
      classes: fresh(features.classes, this.seen.classes),
      ids: fresh(features.ids, this.seen.ids),
      hrefs: fresh(features.hrefs, this.seen.hrefs),
    };
    if (dom.classes.length || dom.ids.length || dom.hrefs.length) this.insert(this.blocker.cosmeticStyles(url, dom));
  }

  private insert(styles: string): void {
    if (styles && !this.contents.isDestroyed()) this.contents.insertCSS(styles, { cssOrigin: "user" }).catch(() => {});
  }
}
