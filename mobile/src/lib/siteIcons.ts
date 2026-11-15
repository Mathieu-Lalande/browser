import { sanitizeSiteIcons, siteIconFor, type SiteIcons } from "@shared/sync/favicons";
import { KEYS, loadDocument, saveDocument } from "./storage";

/**
 * Synced site icons on the phone (ADR-057): the small PNGs other devices send for the origins of
 * the bookmarks and favorites (collection `favicons`), kept in `browser.site-icons`. `SiteIcon`
 * shows one before falling back on the site's own `/favicon.ico` (no request for a known site).
 * `ready` stays false until the stored copy was read: the sync adapter waits for it, so an empty
 * store at startup is never taken for deletions.
 */
const VERSION = 1;

class SiteIconStore {
  private icons: SiteIcons = {};
  ready = false;
  private loading: Promise<void> | null = null;

  load(): Promise<void> {
    this.loading ??= loadDocument(KEYS.siteIcons, VERSION).then((data) => {
      this.icons = { ...sanitizeSiteIcons(data), ...this.icons };
      this.ready = true;
    });
    return this.loading;
  }

  get(): SiteIcons {
    return this.icons;
  }

  set(next: SiteIcons): void {
    if (next === this.icons) return;
    this.icons = next;
    saveDocument(KEYS.siteIcons, VERSION, () => this.icons);
  }

  iconFor(url: string): string | null {
    return siteIconFor(this.icons, url);
  }
}

export const siteIcons = new SiteIconStore();
