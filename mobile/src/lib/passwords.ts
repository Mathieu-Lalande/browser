import { t as tr } from "@shared/i18n";
import { mergeSyncedPasswords, type SyncedPassword } from "@shared/passwords-sync";
import {
  EMPTY_VAULT,
  MAX_PASSWORD,
  MAX_USERNAME,
  captureOutcome,
  entriesFor,
  markUsed,
  passwordOrigin,
  removeEntry,
  sanitizeVault,
  saveCapture,
  setNever,
  type CaptureOutcome,
  type PasswordCapture,
  type PasswordEntry,
  type PasswordVault,
} from "@shared/passwords";

/**
 * Password manager on the phone (ADR-025): the shared model (`@shared/passwords`) kept in
 * `expo-secure-store` (iOS Keychain, Android Keystore; works in Expo Go). Pages talk to the app
 * through the WebView bridge, which any page can use: a capture message is untrusted input, its
 * origin is never taken from the page but from the tab's own URL, and filling is a script the app
 * injects only when the user taps an account.
 */

/** What the store needs from `expo-secure-store` (injectable for tests). */
export interface SecretStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: object): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/**
 * Secure-store values are kept small (some iOS versions refuse large ones): the vault is written
 * as JSON in chunks `passwords.0`, `passwords.1`… and their count in `passwords.n`.
 */
export const CHUNK_SIZE = 1800;
/** Larger than this, the vault is refused rather than written partially. */
const MAX_CHUNKS = 2000;

/** A JSON document read from chunks `<prefix>.0…` (count in `<prefix>.n`); null when missing or damaged. */
export async function readChunks(store: SecretStore, prefix: string): Promise<unknown> {
  const count = Number(await store.getItemAsync(`${prefix}.n`));
  if (!Number.isInteger(count) || count <= 0 || count > MAX_CHUNKS) return null;
  const parts: string[] = [];
  for (let index = 0; index < count; index++) {
    const part = await store.getItemAsync(`${prefix}.${index}`);
    if (part === null) return null;
    parts.push(part);
  }
  try {
    return JSON.parse(parts.join(""));
  } catch {
    return null;
  }
}

/** Writes a JSON document in chunks (see `readChunks`); `tooLarge`: the French error when it does not fit. */
export async function writeChunks(store: SecretStore, prefix: string, value: unknown, options?: object, tooLarge = tr("mobile.libPasswords.tooMuchDataSaved")): Promise<void> {
  const json = JSON.stringify(value);
  const count = Math.ceil(json.length / CHUNK_SIZE);
  if (count > MAX_CHUNKS) throw new Error(tooLarge);
  const countKey = `${prefix}.n`;
  const previous = Number(await store.getItemAsync(countKey)) || 0;
  // Readers trust the count: it is lowered first, and raised once every chunk is written.
  if (previous > count) await store.setItemAsync(countKey, String(count), options);
  for (let index = 0; index < count; index++) await store.setItemAsync(`${prefix}.${index}`, json.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE), options);
  await store.setItemAsync(countKey, String(count), options);
  for (let index = count; index < previous && index < MAX_CHUNKS; index++) await store.deleteItemAsync(`${prefix}.${index}`);
}

export async function loadVault(store: SecretStore): Promise<PasswordVault> {
  const value = await readChunks(store, "passwords");
  return value === null ? EMPTY_VAULT : sanitizeVault(value);
}

export const saveVault = (store: SecretStore, vault: PasswordVault, options?: object): Promise<void> =>
  writeChunks(store, "passwords", vault, options, tr("mobile.libPasswords.tooManyPasswordsSaved"));

/** In-memory vault with its secure-store persistence; listeners hear every change. */
export class PasswordStore {
  private vault: PasswordVault = EMPTY_VAULT;
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private loaded = false;
  /** Writes in order: a later save never lands before an earlier one. */
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: SecretStore,
    private readonly options?: object,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
  ) {}

  load(): Promise<void> {
    this.loading ??= loadVault(this.store).then((vault) => {
      this.vault = vault;
      this.loaded = true;
      this.emit();
    });
    return this.loading;
  }

  get current(): PasswordVault {
    return this.vault;
  }

  /** Read from the secure store: only then may sync compare it (an unread vault is not an empty one). */
  get ready(): boolean {
    return this.loaded;
  }

  /** Remote winners from sync (ADR-050): accounts and "never" sites, ids and last use kept. */
  applySynced(upserts: readonly { id: string; data: SyncedPassword }[], deletes: readonly string[]): Promise<void> {
    return this.commit(mergeSyncedPasswords(this.vault, upserts, deletes, this.newId));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Entries for the page at `url` (exact origin). */
  forUrl(url: string): PasswordEntry[] {
    const origin = passwordOrigin(url);
    return origin ? entriesFor(this.vault, origin) : [];
  }

  outcome(capture: PasswordCapture): CaptureOutcome {
    return captureOutcome(this.vault, capture);
  }

  save(capture: PasswordCapture): Promise<void> {
    return this.commit(saveCapture(this.vault, capture, this.now(), this.newId()));
  }

  never(origin: string): Promise<void> {
    return this.commit(setNever(this.vault, origin, true));
  }

  removeNever(origin: string): Promise<void> {
    return this.commit(setNever(this.vault, origin, false));
  }

  remove(id: string): Promise<void> {
    return this.commit(removeEntry(this.vault, id));
  }

  used(id: string): Promise<void> {
    return this.commit(markUsed(this.vault, id, this.now()));
  }

  private commit(next: PasswordVault): Promise<void> {
    this.vault = next;
    this.emit();
    this.writing = this.writing.then(() => saveVault(this.store, next, this.options)).catch(() => {});
    return this.writing;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

// --- WebView bridge ---------------------------------------------------------------------------

const MAX_MESSAGE = 4096;

/**
 * A login capture posted by the injected script, checked like any page input. It must carry the
 * nonce of the script injected in this document (frames and earlier documents do not know it).
 * The origin is the tab's (`pageUrl`, from the WebView's navigation events), never one the page names.
 */
export function parsePasswordMessage(data: unknown, nonce: string, pageUrl: string): PasswordCapture | null {
  if (typeof data !== "string" || data.length > MAX_MESSAGE) return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const message = value as Record<string, unknown>;
  const origin = passwordOrigin(pageUrl);
  if (message.type !== "password-capture" || !origin || !nonce || message.nonce !== nonce) return null;
  if (typeof message.username !== "string" || message.username.length > MAX_USERNAME) return null;
  if (typeof message.password !== "string" || !message.password || message.password.length > MAX_PASSWORD) return null;
  // eslint-disable-next-line no-control-regex
  return { origin, username: message.username.replace(/[\u0000-\u001f\u007f]/g, "").trim(), password: message.password };
}

/** Rate limit of save prompts per tab: a page cannot pop them in a loop. */
export const PASSWORD_PROMPT_COOLDOWN_MS = 3000;

/**
 * Which capture messages a tab accepts (ADR-025). Each main-frame document gets the capture
 * script with a fresh random nonce, kept in the script's closure: a frame (any origin can post to
 * the native bridge) or an earlier document cannot produce it. Nothing is accepted while a load
 * is in progress, nor when the message's or the tab's URL is not on the origin the script was
 * injected for.
 */
export class PasswordCaptureGuard {
  private nonce: string | null = null;
  private origin: string | null = null;

  constructor(private readonly newNonce: () => string) {}

  /** A main-frame load started: the previous document's script no longer counts. */
  loadStarted(): void {
    this.nonce = null;
    this.origin = null;
  }

  /** A main-frame load ended on `url`: the script to inject there, or null (not a web page). */
  loadEnded(url: string): string | null {
    this.origin = passwordOrigin(url);
    this.nonce = this.origin ? this.newNonce() : null;
    return this.nonce ? passwordCaptureScript(this.nonce) : null;
  }

  /** A WebView message (`messageUrl`: the native event's URL; `pageUrl`: the tab's current page). */
  parse(data: unknown, messageUrl: string, pageUrl: string): PasswordCapture | null {
    if (!this.nonce || !this.origin) return null;
    if (passwordOrigin(messageUrl) !== this.origin || passwordOrigin(pageUrl) !== this.origin) return null;
    return parsePasswordMessage(data, this.nonce, pageUrl);
  }
}

/**
 * Injected by the app after each main-frame load (normal tabs only), with that document's nonce.
 * Watches trusted login submissions (form submit, submit button, Enter in a password field) and
 * posts the username and password once per login. The page can read its own form anyway: nothing
 * is exposed to it. No global "already installed" flag: a newer injection's nonce is the only one
 * accepted, so listeners left by an older one are ignored.
 */
export function passwordCaptureScript(nonce: string): string {
  return `(function(nonce){
var post=window.ReactNativeWebView&&window.ReactNativeWebView.postMessage.bind(window.ReactNativeWebView);
if(!post)return;
var textual={"":1,text:1,email:1,tel:1},last="",lastAt=0;
function snapshot(scope){var pw=[].slice.call(scope.querySelectorAll('input[type="password"]')).filter(function(e){return e.value;});
if(!pw.length)return null;var n=pw.length;var p=n>=2&&pw[n-1].value===pw[n-2].value?pw[n-2]:pw[0];var user="";
var tagged=scope.querySelector('input[autocomplete~="username"],input[autocomplete~="email"]');
if(tagged&&tagged.value&&tagged.type!=="password")user=tagged.value;else{var all=[].slice.call(scope.querySelectorAll("input"));
for(var i=all.indexOf(p)-1;i>=0;i--){if(textual[all[i].type]&&all[i].value){user=all[i].value;break;}}}
return{type:"password-capture",nonce:nonce,username:String(user).slice(0,${MAX_USERNAME}),password:String(p.value).slice(0,${MAX_PASSWORD})};}
function emit(scope){var s=snapshot(scope||document);if(!s)return;var key=s.username+"\\n"+s.password,now=Date.now();
if(key===last&&now-lastAt<3000)return;last=key;lastAt=now;post(JSON.stringify(s));}
function scopeOf(el){return(el&&el.form)||(el&&el.closest&&el.closest("form"))||document;}
document.addEventListener("submit",function(e){if(e.isTrusted)emit(e.target);},true);
document.addEventListener("click",function(e){if(!e.isTrusted||!e.target||!e.target.closest)return;
var b=e.target.closest('button:not([type="button"]):not([type="reset"]),input[type="submit"]');if(b)emit(scopeOf(b));},true);
document.addEventListener("keydown",function(e){var t=e.target;if(e.isTrusted&&e.key==="Enter"&&t&&t.type==="password")emit(scopeOf(t));},true);
})(${JSON.stringify(nonce)});true;`;
}

/** 128 random bits, hex: one per injected capture script. */
export const captureNonce = (randomBytes: (length: number) => Uint8Array): string =>
  Array.from(randomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Fills the page's login form, only if it is still on the entry's origin. Injected on the user's tap. */
export function passwordFillScript(entry: Pick<PasswordEntry, "origin" | "username" | "password">): string {
  return `(function(origin,username,password){
if(location.origin!==origin)return;
function usable(e){return !e.disabled&&!e.readOnly&&e.getClientRects().length>0;}
var field=[].slice.call(document.querySelectorAll('input[type="password"]')).filter(usable)[0];if(!field)return;
var scope=field.form||document,inputs=[].slice.call(scope.querySelectorAll("input")).filter(usable),textual={"":1,text:1,email:1,tel:1};
var user=scope.querySelector('input[autocomplete~="username"]');if(!user||!usable(user)){user=null;
for(var i=inputs.indexOf(field)-1;i>=0;i--){if(textual[inputs[i].type]){user=inputs[i];break;}}}
var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;
function set(e,v){e.focus();setter.call(e,v);e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));}
if(user&&username)set(user,username);set(field,password);
})(${JSON.stringify(entry.origin)},${JSON.stringify(entry.username)},${JSON.stringify(entry.password)});true;`;
}
