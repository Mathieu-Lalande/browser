import { normalizeThemeColor, siteAccent } from "@shared/site-color";
import { accentVariables, type ResolvedMode } from "@shared/theme";
import { toRnColor, withAlpha, type AppColors } from "./colors";
import { captureNonce } from "./passwords";

/**
 * Dynamic theme on the phone (ADR-038, ADR-050; off by default, `settings.appearance.dynamicTheme`).
 * A watcher injected after each main-frame load (fresh random nonce per document, as the media
 * watcher of ADR-035) reports the page's `theme-color` (the one matching the color scheme) when it
 * changes. The value is untrusted: it only ever becomes a color through the shared `site-color.ts`
 * (normalized, chromatic, not near black or white), and the accent through the contrast engine.
 * Favicon colors are not read on the phone. Never in a private tab (its palette is fixed).
 */

export const THEME_COLOR_MESSAGE = "theme-color";

const originOf = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
};

/** Watches `<meta name="theme-color">` (with its `media`), posting the value with this document's nonce when it changes. */
export function themeColorWatchScript(nonce: string): string {
  return `(function(nonce){
var post=window.ReactNativeWebView&&window.ReactNativeWebView.postMessage.bind(window.ReactNativeWebView);
if(!post)return;
var last;
function pick(){var metas=document.querySelectorAll('meta[name="theme-color" i]');
for(var i=0;i<metas.length;i++){var m=metas[i].getAttribute("media");if(!m||window.matchMedia(m).matches)return String(metas[i].getAttribute("content")||"").slice(0,64);}
return "";}
function report(){var color=pick();if(color===last)return;last=color;post(JSON.stringify({type:${JSON.stringify(THEME_COLOR_MESSAGE)},nonce:nonce,color:color}));}
report();
if(document.head)new MutationObserver(report).observe(document.head,{childList:true,subtree:true,attributes:true,attributeFilter:["content","media"]});
if(window.matchMedia)window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",report);
})(${JSON.stringify(nonce)});true;`;
}

/** Which theme-color messages a tab accepts: this document's nonce, while message and page share the injected origin. */
export class ThemeColorGuard {
  private nonce: string | null = null;
  private origin: string | null = null;

  constructor(private readonly newNonce: () => string) {}

  loadStarted(): void {
    this.nonce = null;
    this.origin = null;
  }

  /** The watcher for the document that just loaded, or null (not a web page). */
  loadEnded(url: string): string | null {
    this.origin = originOf(url);
    this.nonce = this.origin ? this.newNonce() : null;
    return this.nonce ? themeColorWatchScript(this.nonce) : null;
  }

  /** The site accent a message reports (null: none worth following); undefined when not one of ours. */
  parse(data: unknown, messageUrl: string, pageUrl: string): string | null | undefined {
    if (!this.nonce || !this.origin || typeof data !== "string" || data.length > 512 || !data.includes(THEME_COLOR_MESSAGE)) return undefined;
    if (originOf(messageUrl) !== this.origin || originOf(pageUrl) !== this.origin) return undefined;
    let message: { type?: unknown; nonce?: unknown; color?: unknown };
    try {
      message = JSON.parse(data);
    } catch {
      return undefined;
    }
    if (message?.type !== THEME_COLOR_MESSAGE || message.nonce !== this.nonce) return undefined;
    return siteAccent({ themeColor: normalizeThemeColor(message.color) });
  }
}

export const newThemeColorNonce = (randomBytes: (length: number) => Uint8Array): string => captureNonce(randomBytes);

/** The app colors with the site's accent (the contrast engine keeps `accentText` at WCAG AA on the backgrounds). */
export function withSiteAccent(colors: AppColors, site: string | null, mode: ResolvedMode): AppColors {
  if (!site) return colors;
  const vars = accentVariables(site, mode);
  const accent = toRnColor(vars["--accent"]);
  return { ...colors, accent, accentText: toRnColor(vars["--accent-text"]), onAccent: toRnColor(vars["--on-accent"]), accentSoft: withAlpha(vars["--accent"], mode === "dark" ? 0.22 : 0.14) };
}

// The active tab's site accent, set by the browser screen and read by the theme (above it).
let current: string | null = null;
const listeners = new Set<() => void>();
export const siteAccentStore = {
  get: (): string | null => current,
  set(next: string | null): void {
    if (next === current) return;
    current = next;
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
