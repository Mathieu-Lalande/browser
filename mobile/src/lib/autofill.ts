import { t as tr } from "@shared/i18n";
import {
  EMPTY_AUTOFILL,
  fillPlan,
  focusedSection,
  markUsed,
  removeAddress,
  removeCard,
  sanitizeAutofill,
  sanitizeFields,
  type AutofillData,
  type FieldSection,
  type FillStep,
  type SavedAddress,
  type SavedCard,
} from "@shared/autofill";
import { passwordOrigin } from "@shared/passwords";
import { readChunks, writeChunks, type SecretStore } from "./passwords";

/**
 * Addresses and payment cards on the phone (ADR-041): the shared model (`@shared/autofill`) kept
 * in `expo-secure-store` (chunks `autofill.*`). Filling is only ever on the user's tap (page menu):
 * the app injects a describe script carrying a fresh nonce, the page answers with its fields
 * through the WebView bridge (untrusted input, checked), the app classifies them with the shared
 * rules and injects the values by field index. Never in a private tab; never a security code.
 */

const PREFIX = "autofill";

export class AutofillStore {
  private data: AutofillData = EMPTY_AUTOFILL;
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: SecretStore,
    private readonly options?: object,
    private readonly now: () => number = Date.now,
  ) {}

  load(): Promise<void> {
    this.loading ??= readChunks(this.store, PREFIX).then((value) => {
      this.data = value === null ? EMPTY_AUTOFILL : sanitizeAutofill(value);
      this.emit();
    });
    return this.loading;
  }

  get current(): AutofillData {
    return this.data;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  remove(section: FieldSection, id: string): Promise<void> {
    return this.commit(section === "card" ? removeCard(this.data, id) : removeAddress(this.data, id));
  }

  used(section: FieldSection, id: string): Promise<void> {
    return this.commit(markUsed(this.data, section, id, this.now()));
  }

  /** Synced addresses applied (ADR-019); cards are never part of sync. */
  replace(next: AutofillData): Promise<void> {
    return this.commit(next);
  }

  private commit(next: AutofillData): Promise<void> {
    this.data = next;
    for (const listener of this.listeners) listener();
    this.writing = this.writing.then(() => writeChunks(this.store, PREFIX, next, this.options, tr("mobile.autofill.tooManyAddressesCards"))).catch(() => {});
    return this.writing;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export type AutofillChoice = { section: "address"; entry: SavedAddress } | { section: "card"; entry: SavedCard };

const MESSAGE = "autofill-fields";
const MAX_MESSAGE = 120_000;

/** Lists the fields of the focused form (or the first form), posted back with the nonce. */
export function autofillDescribeScript(nonce: string): string {
  return `(function(nonce){
var post=window.ReactNativeWebView&&window.ReactNativeWebView.postMessage.bind(window.ReactNativeWebView);if(!post)return;
var skip={hidden:1,submit:1,button:1,reset:1,image:1,file:1,checkbox:1,radio:1,range:1,color:1,date:1,time:1,week:1,password:1};
function fieldsOf(scope){return [].slice.call(scope.querySelectorAll("input,select,textarea")).filter(function(e){return !e.disabled&&!e.readOnly&&e.getClientRects().length>0&&!skip[(e.type||"").toLowerCase()];}).slice(0,200);}
function labelOf(e){if(e.labels&&e.labels[0])return e.labels[0].textContent||"";var p=e.previousElementSibling;return p&&p.tagName==="LABEL"?p.textContent||"":"";}
var a=document.activeElement,scope=(a&&a.form)||(a&&a.closest&&a.closest("form"))||document.forms[0]||document;
var list=fieldsOf(scope).map(function(e){var t=e.tagName.toLowerCase();var f={tag:t,type:t==="input"?(e.type||"text").toLowerCase():"",autocomplete:e.getAttribute("autocomplete")||"",name:e.name||"",id:e.id||"",label:String(labelOf(e)).trim().slice(0,200),placeholder:e.getAttribute("placeholder")||"",ariaLabel:e.getAttribute("aria-label")||"",maxLength:t==="input"?e.maxLength:-1};
if(t==="select")f.options=[].slice.call(e.options,0,300).map(function(o){return{value:o.value,text:(o.textContent||"").trim()};});return f;});
window.__browserAutofillScope=scope;post(JSON.stringify({type:${JSON.stringify(MESSAGE)},nonce:nonce,fields:list}));
})(${JSON.stringify(nonce)});true;`;
}

/** Puts the values in the described form, if the page is still on `origin` and the form unchanged. */
export function autofillFillScript(origin: string, count: number, steps: readonly FillStep[]): string {
  return `(function(origin,count,steps){
if(location.origin!==origin)return;var scope=window.__browserAutofillScope||document;
var skip={hidden:1,submit:1,button:1,reset:1,image:1,file:1,checkbox:1,radio:1,range:1,color:1,date:1,time:1,week:1,password:1};
var fields=[].slice.call(scope.querySelectorAll("input,select,textarea")).filter(function(e){return !e.disabled&&!e.readOnly&&e.getClientRects().length>0&&!skip[(e.type||"").toLowerCase()];}).slice(0,200);
if(fields.length!==count)return;
steps.forEach(function(s){var e=fields[s.index];if(!e)return;var proto=e instanceof HTMLSelectElement?HTMLSelectElement.prototype:e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
Object.getOwnPropertyDescriptor(proto,"value").set.call(e,s.value);e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));});
})(${JSON.stringify(origin)},${count},${JSON.stringify(steps)});true;`;
}

/**
 * One fill request of a tab: `start` gives the describe script (fresh nonce, the page's origin),
 * `parse` takes a WebView message — undefined when it is not ours, null when it is refused (other
 * nonce or origin, nothing to fill), else the fill script. One answer per request.
 */
export class AutofillBridge {
  private pending: { nonce: string; origin: string; choice: AutofillChoice } | null = null;

  constructor(private readonly newNonce: () => string) {}

  start(pageUrl: string, choice: AutofillChoice): string | null {
    const origin = passwordOrigin(pageUrl);
    if (!origin) return (this.pending = null);
    const nonce = this.newNonce();
    this.pending = { nonce, origin, choice };
    return autofillDescribeScript(nonce);
  }

  loadStarted(): void {
    this.pending = null;
  }

  parse(data: unknown, messageUrl: string, pageUrl: string): string | null | undefined {
    if (typeof data !== "string" || data.length > MAX_MESSAGE || !data.includes(MESSAGE)) return undefined;
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return undefined;
    }
    if (typeof message !== "object" || message === null || (message as { type?: unknown }).type !== MESSAGE) return undefined;
    const pending = this.pending;
    if (!pending || (message as { nonce?: unknown }).nonce !== pending.nonce) return null;
    this.pending = null;
    if (passwordOrigin(messageUrl) !== pending.origin || passwordOrigin(pageUrl) !== pending.origin) return null;
    const fields = sanitizeFields((message as { fields?: unknown }).fields);
    if (!fields || !fields.some((_, index) => focusedSection(fields, index) === pending.choice.section)) return null;
    const steps = fillPlan(fields, pending.choice);
    return steps.length ? autofillFillScript(pending.origin, fields.length, steps) : null;
  }
}

/** 128 random bits, hex. */
export const autofillNonce = (randomBytes: (length: number) => Uint8Array): string =>
  Array.from(randomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");
