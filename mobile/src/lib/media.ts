import { mediaLabels, parseMediaProbe, type MediaProbe } from "@shared/media";
import { captureNonce } from "./passwords";

/**
 * Mini-player of the phone (ADR-035). Only the tab on screen plays: background tabs are hidden
 * WebViews the OS suspends, so there is no hub of several sources here. A watcher script (fresh
 * random nonce per main-frame document, as the login capture of ADR-025) reports the page's media
 * state; the bar's buttons inject a control script.
 */

export const MEDIA_MESSAGE = "media-state";
/** Reports at most this often while playing (timeupdate fires ~4 times a second). */
const REPORT_MS = 1000;

const originOf = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
};

/**
 * Injected after each main-frame load: follows play/pause of the page's <audio>/<video> (capture
 * phase: media events do not bubble) and posts the state with this document's nonce.
 */
export function mediaWatchScript(nonce: string): string {
  return `(function(nonce){
var post=window.ReactNativeWebView&&window.ReactNativeWebView.postMessage.bind(window.ReactNativeWebView);
if(!post)return;
var last=null,sent=0;
function report(force){var now=Date.now();if(!force&&now-sent<${REPORT_MS})return;sent=now;
var m=last&&last.isConnected?last:null,meta=navigator.mediaSession&&navigator.mediaSession.metadata;
post(JSON.stringify({type:${JSON.stringify(MEDIA_MESSAGE)},nonce:nonce,probe:{title:meta?String(meta.title):"",artist:meta?String(meta.artist):"",album:meta?String(meta.album):"",
artwork:[],hasSession:!!meta,element:m?{duration:m.duration,position:m.currentTime,paused:m.paused,video:m instanceof HTMLVideoElement}:null}}));}
function on(type,force){document.addEventListener(type,function(e){if(!(e.target instanceof HTMLMediaElement))return;
if(type==="play"||!last)last=e.target;if(e.target===last)report(force);},true);}
on("play",true);on("pause",true);on("ended",true);on("timeupdate",false);
})(${JSON.stringify(nonce)});true;`;
}

/** Injected on a tap of the bar: plays or pauses the page's media (the playing one first). */
export function mediaControlScript(action: "toggle" | "pause"): string {
  return `(function(action){
var all=[].slice.call(document.querySelectorAll("video,audio"));
var m=all.find(function(x){return!x.paused&&!x.ended;})||all.find(function(x){return x.currentTime>0;})||all[0];
if(!m)return;if(action==="toggle"&&m.paused){var p=m.play();if(p&&p.catch)p.catch(function(){});}else m.pause();
})(${JSON.stringify(action)});true;`;
}

/**
 * Which media messages a tab accepts: from this document's script only (its nonce), and only
 * while both the message's URL and the tab's page are on the origin the script was injected for.
 */
export class MediaWatchGuard {
  private nonce: string | null = null;
  private origin: string | null = null;

  constructor(private readonly newNonce: () => string) {}

  loadStarted(): void {
    this.nonce = null;
    this.origin = null;
  }

  /** The script to inject in the document that just loaded, or null (not a web page). */
  loadEnded(url: string): string | null {
    this.origin = originOf(url);
    this.nonce = this.origin ? this.newNonce() : null;
    return this.nonce ? mediaWatchScript(this.nonce) : null;
  }

  /** The validated state of a media message; undefined when the message is not one of ours. */
  parse(data: unknown, messageUrl: string, pageUrl: string): MediaProbe | undefined {
    if (!this.nonce || !this.origin || typeof data !== "string" || data.length > 8192) return undefined;
    if (originOf(messageUrl) !== this.origin || originOf(pageUrl) !== this.origin) return undefined;
    let message: { type?: unknown; nonce?: unknown; probe?: unknown };
    try {
      message = JSON.parse(data);
    } catch {
      return undefined;
    }
    if (message?.type !== MEDIA_MESSAGE || message.nonce !== this.nonce) return undefined;
    return parseMediaProbe(message.probe) ?? undefined;
  }
}

export const newMediaNonce = (randomBytes: (length: number) => Uint8Array): string => captureNonce(randomBytes);

/** What the bar shows for a tab: null when it has nothing to control (or the user closed it). */
export function miniBarOf(probe: MediaProbe | null, tab: { title: string; url: string }, dismissed: boolean): { title: string; subtitle: string; playing: boolean } | null {
  if (!probe?.element || dismissed) return null;
  return { ...mediaLabels(probe, tab), playing: !probe.element.paused };
}
