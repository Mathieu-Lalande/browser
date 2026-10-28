import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import {
  addZap,
  boostHostOf,
  boostsFor,
  isValidSelector,
  newBoost,
  pageCss,
  removeZap,
  scriptAllowed,
  siteBoost,
  upsertBoost,
  validateBoostInput,
  type Boost,
  type BoostResult,
} from "@shared/boosts";
import { Channels } from "@shared/ipc";
import type { TabBoost } from "@shared/types";
import { profile } from "../profile";
import { BrowserController } from "../window";
import { SCRIPT_WORLD_ID, ZAP_SCRIPT, ZAP_WORLD_ID, userScript } from "./scripts";

/**
 * Boosts, desktop side (ADR-029): CSS through `insertCSS` (keys kept per page so a change is
 * applied live), user scripts in an isolated world at each new document, the zap tool, and what the
 * site panel and `browser://boosts` do. Boosts live in the profile: a private window applies them
 * (scripts only when the boost allows it) but cannot change them.
 */

const PRIVATE_REFUSAL: BoostResult = { ok: false, message: "Les boosts se modifient depuis une fenêtre normale." };

/** Per page: the keys of the CSS inserted in its current document, and the serialized queue of updates. */
const pages = new WeakMap<WebContents, { keys: string[]; queue: Promise<void> }>();
/** Pages with a zap tool running. */
const zapping = new WeakSet<WebContents>();

export const listBoosts = (): Boost[] => [...profile().boosts];

function stateOf(contents: WebContents) {
  let state = pages.get(contents);
  if (!state) pages.set(contents, (state = { keys: [], queue: Promise.resolve() }));
  return state;
}

/** Replaces the page's boost CSS with the current one (live: no reload). */
function restyle(contents: WebContents): Promise<void> {
  const state = stateOf(contents);
  state.queue = state.queue.then(async () => {
    if (contents.isDestroyed()) return;
    const css = pageCss(profile().boosts, contents.getURL());
    const old = state.keys.splice(0);
    for (const key of old) await contents.removeInsertedCSS(key).catch(() => {});
    if (css && !contents.isDestroyed()) state.keys.push(await contents.insertCSS(css));
  }).catch(() => {});
  return state.queue;
}

/**
 * A new document is ready (dom-ready, also in private windows): its CSS from scratch (the previous
 * document's keys died with it), then the scripts allowed there, each in the boosts' isolated world.
 */
export function boostPage(contents: WebContents, isPrivate: boolean): void {
  stateOf(contents).keys = [];
  void restyle(contents);
  for (const boost of boostsFor(profile().boosts, contents.getURL())) {
    if (!scriptAllowed(boost, isPrivate)) continue;
    contents.executeJavaScriptInIsolatedWorld(SCRIPT_WORLD_ID, [{ code: userScript(boost.script.code) }]).catch(() => {});
  }
}

/** After a change: every open page restyled, every UI told. Scripts apply at the next load. */
function refreshAll(): void {
  for (const c of BrowserController.all()) {
    for (const { manager, tab } of c.spaces.allTabs()) {
      const contents = manager.pageOf(tab.id);
      if (contents && !contents.isDestroyed()) void restyle(contents);
    }
    c.send(Channels.boostsChanged);
  }
}

/** Writes the list (UI, zap tool, sync) and applies it everywhere. */
export function setBoosts(next: readonly Boost[]): void {
  profile().saveBoosts(next);
  refreshAll();
}

export function saveBoost(c: BrowserController, input: unknown): BoostResult {
  if (c.isPrivate) return PRIVATE_REFUSAL;
  const id = typeof input === "object" && input !== null && typeof (input as { id?: unknown }).id === "string" ? (input as { id: string }).id : randomUUID();
  const result = validateBoostInput(input, id, Date.now());
  if (result.ok) setBoosts(upsertBoost(profile().boosts, result.boost));
  return result;
}

export function removeBoost(c: BrowserController, id: string): void {
  if (!c.isPrivate) setBoosts(profile().boosts.filter((boost) => boost.id !== id));
}

// --- The tab's site (site panel) ---------------------------------------------------------------

function pageUrl(c: BrowserController, tabId: string): string | null {
  const url = c.tabs.getState().tabs.find((tab) => tab.id === tabId)?.url ?? "";
  return boostHostOf(url) ? url : null;
}

export function boostForTab(c: BrowserController, tabId: string): TabBoost | null {
  const url = pageUrl(c, tabId);
  const host = url && boostHostOf(url);
  if (!url || !host) return null;
  const contents = c.tabs.pageOf(tabId);
  return { host, boost: siteBoost(profile().boosts, url), isPrivate: c.isPrivate, zapping: !!contents && zapping.has(contents) };
}

/** The tab's site boost, created when it has none yet. */
function ensureBoost(url: string): Boost | null {
  const existing = siteBoost(profile().boosts, url);
  if (existing) return existing;
  const host = boostHostOf(url);
  if (!host) return null;
  const boost = newBoost(randomUUID(), host, Date.now());
  setBoosts(upsertBoost(profile().boosts, boost));
  return profile().boosts.some((item) => item.id === boost.id) ? boost : null;
}

export function createBoostForTab(c: BrowserController, tabId: string): TabBoost | null {
  const url = pageUrl(c, tabId);
  if (!url || c.isPrivate) return boostForTab(c, tabId);
  ensureBoost(url);
  return boostForTab(c, tabId);
}

/** "Réafficher" in the site panel: the zap removed from the tab's site boost. */
export function unzap(c: BrowserController, tabId: string, selector: string): TabBoost | null {
  const url = pageUrl(c, tabId);
  const boost = url && siteBoost(profile().boosts, url);
  if (boost && !c.isPrivate) setBoosts(upsertBoost(profile().boosts, removeZap(boost, selector, Date.now())));
  return boostForTab(c, tabId);
}

/**
 * "Masquer des éléments": the zap tool in the tab's page. Each click resolves the script's promise
 * with a selector main validates and saves into the site's boost (created on the first one); the
 * loop ends with Escape or when the page goes away.
 */
export function startZap(c: BrowserController, tabId: string): void {
  const contents = c.tabs.pageOf(tabId);
  if (c.isPrivate || !contents || contents.isDestroyed() || zapping.has(contents) || !pageUrl(c, tabId)) return;
  zapping.add(contents);
  c.overlay.close();
  contents.focus();
  void (async () => {
    try {
      while (!contents.isDestroyed()) {
        const result: unknown = await contents.executeJavaScriptInIsolatedWorld(ZAP_WORLD_ID, [{ code: ZAP_SCRIPT }]).catch(() => null);
        const selector = typeof result === "object" && result !== null ? (result as { selector?: unknown }).selector : undefined;
        if (!isValidSelector(selector)) return;
        const url = contents.getURL();
        const boost = ensureBoost(url);
        if (boost) setBoosts(upsertBoost(profile().boosts, addZap(boost, selector, Date.now())));
      }
    } finally {
      zapping.delete(contents);
    }
  })();
}
