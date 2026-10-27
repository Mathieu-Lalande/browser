/**
 * Long-press on links. WebViews have no cross-platform link context menu, so a small read-only
 * script detects a long press on an `<a href>` and posts its URL. Everything it sends is page
 * controlled (any page can call `ReactNativeWebView.postMessage` itself), so the app treats the
 * message as untrusted input: strict shape, http(s) URL only, length limits, and it can only
 * *show* a menu — every action still needs the user's tap.
 */

const MAX_MESSAGE = 8192;
const MAX_URL = 4096;
const MAX_TEXT = 200;

export interface LinkMenuRequest {
  url: string;
  /** Link text, for the menu header (may be empty). */
  text: string;
}

export function parseLinkMenuMessage(data: unknown): LinkMenuRequest | null {
  if (typeof data !== "string" || data.length > MAX_MESSAGE) return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (message.type !== "link-menu" || typeof message.href !== "string" || message.href.length > MAX_URL) return null;
  let url: URL;
  try {
    url = new URL(message.href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // eslint-disable-next-line no-control-regex
  const text = typeof message.text === "string" ? message.text.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim().slice(0, MAX_TEXT) : "";
  return { url: url.href, text };
}

/** Rate limit: a page cannot open menus in a loop. */
export const LINK_MENU_COOLDOWN_MS = 800;

/**
 * Injected after each page load (main frame only). It only reads the touched link and posts
 * it; it exposes nothing to the page and receives nothing back.
 */
export function linkMenuScript(platform: string): string {
  const hideCallout =
    platform === "ios"
      ? "var s=document.createElement('style');s.textContent='a[href]{-webkit-touch-callout:none}';(document.head||document.documentElement).appendChild(s);"
      : "";
  return `(function(){
var post=window.ReactNativeWebView&&window.ReactNativeWebView.postMessage.bind(window.ReactNativeWebView);
if(!post)return;
var timer=null,sx=0,sy=0;
function clear(){if(timer){clearTimeout(timer);timer=null;}}
function linkOf(t){return t&&t.closest?t.closest('a[href]'):null;}
var opts={passive:true,capture:true};
document.addEventListener('touchstart',function(e){clear();if(e.touches.length!==1)return;var a=linkOf(e.target);if(!a)return;
var p=e.touches[0];sx=p.clientX;sy=p.clientY;
timer=setTimeout(function(){timer=null;post(JSON.stringify({type:'link-menu',href:String(a.href),text:String(a.innerText||'').slice(0,${MAX_TEXT})}));},480);},opts);
document.addEventListener('touchmove',function(e){var p=e.touches[0];if(p&&(Math.abs(p.clientX-sx)>10||Math.abs(p.clientY-sy)>10))clear();},opts);
document.addEventListener('touchend',clear,opts);
document.addEventListener('touchcancel',clear,opts);
document.addEventListener('contextmenu',function(e){if(linkOf(e.target))e.preventDefault();},true);
${hideCallout}
})();true;`;
}
