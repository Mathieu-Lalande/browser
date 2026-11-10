/**
 * Find in page (ADR-055). The phone has no native find API common to both WebViews, so a script
 * injected on the user's request marks the matches (`<mark data-browser-find>`), scrolls to the
 * current one and posts `{ current, total }`. Same rules as the translation bridge (ADR-036): a
 * fresh random nonce per search, answers accepted from the searched origin only, everything reset
 * when a new document starts loading. The page only ever receives the query as a JSON string.
 */

export const FIND_MESSAGE = "find-result";
/** Matches marked at most (a one-letter query on a long page stays cheap). */
export const MAX_FIND_MATCHES = 1000;
/** Longest query sent to the page. */
export const MAX_FIND_QUERY = 200;
const MAX_MESSAGE_LENGTH = 512;

export interface FindResult {
  /** 1-based index of the current match, 0 when there is none. */
  current: number;
  total: number;
}

export type FindStep = "next" | "previous";

const originOf = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
};

/** The query as sent to the page: control characters dropped, whitespace collapsed, capped. */
export function cleanFindQuery(query: string): string {
  // eslint-disable-next-line no-control-regex
  return query.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_FIND_QUERY);
}

/**
 * The page side: one state object (`window.__browserFind`, not enumerable) for the running
 * search; `op` is "search", "next", "previous" or "clear". Marks of an older search are removed
 * first; text in scripts, styles, form fields and hidden elements is skipped. Case-insensitive
 * when lowercasing keeps the text length (else exact), so offsets stay valid.
 */
export function findScript(nonce: string, op: "search" | FindStep | "clear", query = ""): string {
  return `(function(nonce,op,query){
var KEY="__browserFind",post=window.ReactNativeWebView&&window.ReactNativeWebView.postMessage.bind(window.ReactNativeWebView);
var state=window[KEY];
function unwrap(){var marks=[].slice.call(document.querySelectorAll("mark[data-browser-find]"));
marks.forEach(function(m){var p=m.parentNode;if(!p)return;while(m.firstChild)p.insertBefore(m.firstChild,m);p.removeChild(m);if(p.normalize)p.normalize();});}
function paint(){if(!state)return;state.marks.forEach(function(m,i){m.style.background=i===state.index?"#ff9632":"#ffeb3b";m.style.color="#000";});
var cur=state.marks[state.index];if(cur&&cur.scrollIntoView)cur.scrollIntoView({block:"center",inline:"nearest"});}
function report(){if(!post||!state)return;post(JSON.stringify({type:${JSON.stringify(FIND_MESSAGE)},nonce:nonce,current:state.marks.length?state.index+1:0,total:state.marks.length}));}
if(op==="clear"){unwrap();try{delete window[KEY];}catch(e){window[KEY]=undefined;}return;}
if(op!=="search"){if(!state||state.nonce!==nonce||!state.marks.length)return;
state.index=(state.index+(op==="next"?1:-1)+state.marks.length)%state.marks.length;paint();report();return;}
unwrap();state={nonce:nonce,marks:[],index:0};
try{Object.defineProperty(window,KEY,{value:state,configurable:true,writable:true,enumerable:false});}catch(e){window[KEY]=state;}
if(!query||!document.body){report();return;}
var lower=query.toLowerCase(),fold=lower.length===query.length,needle=fold?lower:query;
var skip={SCRIPT:1,STYLE:1,NOSCRIPT:1,TEXTAREA:1,INPUT:1,SELECT:1,OPTION:1,TEMPLATE:1,IFRAME:1,SVG:1,CANVAS:1};
var walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode:function(n){
var e=n.parentElement;if(!e||!n.nodeValue||skip[e.nodeName.toUpperCase()]||e.closest("[hidden],[aria-hidden=true]"))return NodeFilter.FILTER_REJECT;
return NodeFilter.FILTER_ACCEPT;}});
var nodes=[],n;while((n=walker.nextNode()))nodes.push(n);
for(var i=0;i<nodes.length&&state.marks.length<${MAX_FIND_MATCHES};i++){var node=nodes[i],text=node.nodeValue,hay=fold?text.toLowerCase():text;
if(hay.length!==text.length)hay=text;var from=0,hits=[];
while(state.marks.length+hits.length<${MAX_FIND_MATCHES}){var at=hay.indexOf(needle,from);if(at<0)break;hits.push(at);from=at+needle.length;}
for(var h=hits.length-1;h>=0;h--){var tail=node.splitText(hits[h]);tail.splitText(needle.length);
var mark=document.createElement("mark");mark.setAttribute("data-browser-find","");tail.parentNode.insertBefore(mark,tail);mark.appendChild(tail);hits[h]=mark;}
for(var k=0;k<hits.length;k++)state.marks.push(hits[k]);}
var visible=state.marks.filter(function(m){return m.getClientRects().length>0;});
state.marks.forEach(function(m){if(visible.indexOf(m)<0){var p=m.parentNode;while(m.firstChild)p.insertBefore(m.firstChild,m);p.removeChild(m);}});
state.marks=visible;state.index=0;paint();report();
})(${JSON.stringify(nonce)},${JSON.stringify(op)},${JSON.stringify(cleanFindQuery(query))});true;`;
}

/** One tab's find session: the nonce of the running search and the origin it was injected for. */
export class FindBridge {
  private nonce: string | null = null;
  private origin: string | null = null;

  constructor(private readonly newNonce: () => string) {}

  get active(): boolean {
    return this.nonce !== null;
  }

  /** A main-frame load started: the marks went with the old document. */
  loadStarted(): void {
    this.nonce = null;
    this.origin = null;
  }

  /** The script searching the page at `url` for `query` (a fresh nonce); null: not a web page. */
  search(url: string, query: string): string | null {
    this.origin = originOf(url);
    this.nonce = this.origin ? this.newNonce() : null;
    return this.nonce ? findScript(this.nonce, "search", query) : null;
  }

  /** Moves to the next or previous match of the running search. */
  step(direction: FindStep): string | null {
    return this.nonce ? findScript(this.nonce, direction) : null;
  }

  /** Removes the marks; the bridge then ignores the page. */
  clear(): string | null {
    const script = this.nonce ? findScript(this.nonce, "clear") : null;
    this.nonce = null;
    this.origin = null;
    return script;
  }

  /**
   * A WebView message: `undefined` when it is not a find message, null when it is not for the
   * running search (other nonce or origin), else the validated counts.
   */
  parse(data: unknown, messageUrl: string, pageUrl: string): FindResult | null | undefined {
    if (typeof data !== "string" || data.length > MAX_MESSAGE_LENGTH || !data.includes(FIND_MESSAGE)) return undefined;
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return undefined;
    }
    if (typeof message !== "object" || message === null || (message as { type?: unknown }).type !== FIND_MESSAGE) return undefined;
    const { nonce, current, total } = message as { nonce?: unknown; current?: unknown; total?: unknown };
    if (!this.nonce || nonce !== this.nonce) return null;
    if (originOf(messageUrl) !== this.origin || originOf(pageUrl) !== this.origin) return null;
    if (!Number.isInteger(total) || !Number.isInteger(current)) return null;
    const count = Math.min(Math.max(total as number, 0), MAX_FIND_MATCHES);
    const index = count === 0 ? 0 : Math.min(Math.max(current as number, 1), count);
    return { current: index, total: count };
  }
}

/** 128 random bits, hex. */
export const findNonce = (randomBytes: (length: number) => Uint8Array): string =>
  Array.from(randomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");
