import { annotationUrl, highlightsFor, markOf, sanitizeQuote, type AnnotationsData, type HighlightMark, type TextQuote } from "@shared/annotations/model";
import { ANNOTATOR_FACTORY, highlightCss } from "@shared/annotations/page-script";

/**
 * Highlights on the phone (ADR-037): the shared annotator, injected into each document of a normal
 * tab with a fresh random nonce kept in its closure (same rule as the password capture, ADR-025).
 * WebViews have no usable isolated world: the page could call the annotator, but it can only ever
 * make it report a quote of its own text or a click on a highlight id the app checks; the bridge
 * accepts messages carrying the nonce, from the main frame's origin, until the next load.
 */

export const ANNOTATE_MESSAGE = "browser-annotate";
const MAX_MESSAGE_LENGTH = 20_000;

const globalOf = (nonce: string) => `window[${JSON.stringify(`__browserAnnotate_${nonce}`)}]`;

/** Creates the annotator (and its CSS) in the document, then draws `marks`. */
export function annotatorScript(nonce: string, marks: readonly HighlightMark[]): string {
  return `(function(nonce){
var post=window.ReactNativeWebView&&window.ReactNativeWebView.postMessage.bind(window.ReactNativeWebView);
if(!post||!document.body)return;
var key="__browserAnnotate_"+nonce;
if(!window[key]){
var style=document.createElement("style");style.textContent=${JSON.stringify(highlightCss())};(document.head||document.documentElement).appendChild(style);
window[key]=(${ANNOTATOR_FACTORY})(function(message){post(JSON.stringify({type:${JSON.stringify(ANNOTATE_MESSAGE)},nonce:nonce,kind:message.type,id:message.id}));});
}
window[key].apply(${JSON.stringify(marks)});
})(${JSON.stringify(nonce)});true;`;
}

/** Sends the selection back as `{type, nonce, kind: "capture", quote}`. */
export function captureScript(nonce: string): string {
  return `(function(){var a=${globalOf(nonce)};var post=window.ReactNativeWebView;if(!a||!post)return;
post.postMessage(JSON.stringify({type:${JSON.stringify(ANNOTATE_MESSAGE)},nonce:${JSON.stringify(nonce)},kind:"capture",quote:a.capture()}));
if(window.getSelection())window.getSelection().removeAllRanges();})();true;`;
}

export function scrollScript(nonce: string, id: string): string {
  return `(function(){var a=${globalOf(nonce)};if(a)a.scrollTo(${JSON.stringify(id)});})();true;`;
}

/** The highlights of a page, as the annotator draws them. */
export const marksFor = (data: AnnotationsData, url: string): HighlightMark[] => {
  const key = annotationUrl(url);
  return key ? highlightsFor(data, key).map(markOf) : [];
};

const originOf = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
};

export type AnnotateMessage = { kind: "capture"; quote: TextQuote | null } | { kind: "click"; id: string };

/** Ties the annotator's messages to the document it was injected into. */
export class AnnotateBridge {
  private nonce: string | null = null;
  private origin: string | null = null;

  constructor(private readonly newNonce: () => string) {}

  loadStarted(): void {
    this.nonce = null;
    this.origin = null;
  }

  /** The script for the document that just loaded at `url` (null: not a web page). */
  loadEnded(url: string, marks: readonly HighlightMark[]): string | null {
    this.origin = originOf(url);
    this.nonce = this.origin ? this.newNonce() : null;
    return this.nonce ? annotatorScript(this.nonce, marks) : null;
  }

  /** Redraws the current document's highlights (after a change). */
  redraw(marks: readonly HighlightMark[]): string | null {
    return this.nonce ? annotatorScript(this.nonce, marks) : null;
  }

  capture(): string | null {
    return this.nonce ? captureScript(this.nonce) : null;
  }

  scrollTo(id: string): string | null {
    return this.nonce ? scrollScript(this.nonce, id) : null;
  }

  /** `undefined`: not an annotator message for this document; else the validated message. */
  parse(data: unknown, messageUrl: string, pageUrl: string): AnnotateMessage | undefined {
    if (!this.nonce || typeof data !== "string" || data.length > MAX_MESSAGE_LENGTH || !data.includes(ANNOTATE_MESSAGE)) return undefined;
    if (originOf(messageUrl) !== this.origin || originOf(pageUrl) !== this.origin) return undefined;
    let message: { type?: unknown; nonce?: unknown; kind?: unknown; quote?: unknown; id?: unknown };
    try {
      message = JSON.parse(data);
    } catch {
      return undefined;
    }
    if (message?.type !== ANNOTATE_MESSAGE || message.nonce !== this.nonce) return undefined;
    if (message.kind === "capture") return { kind: "capture", quote: sanitizeQuote(message.quote) };
    if (message.kind === "click" && typeof message.id === "string") return { kind: "click", id: message.id };
    return undefined;
  }
}

/** 128 random bits, hex. */
export const annotateNonce = (randomBytes: (length: number) => Uint8Array): string =>
  Array.from(randomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");
