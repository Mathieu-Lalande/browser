import { t } from "@shared/i18n";
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
import type { WindowDirectory, WindowPort } from "../ports";
import { SCRIPT_WORLD_ID, ZAP_SCRIPT, ZAP_WORLD_ID, userScript } from "./scripts";

const PRIVATE_REFUSAL: BoostResult = { ok: false, get message() { return t("boostsService.boostsAreEditedFrom") } };

/** Where the boosts are kept (the profile's `boosts.json`). */
export interface BoostStore {
  list(): readonly Boost[];
  save(next: readonly Boost[]): void;
}

export interface BoostServiceDeps {
  store: BoostStore;
  windows: WindowDirectory;
  now?: () => number;
  newId?: () => string;
}

/** Per page: the keys of the CSS inserted in its current document, and the serialized queue of updates. */
interface PageStyle {
  keys: string[];
  queue: Promise<void>;
}

/**
 * Boosts, desktop side (ADR-029): CSS through `insertCSS` (keys kept per page so a change is
 * applied live), user scripts in an isolated world at each new document, the zap tool, and what the
 * site panel and `browser://boosts` do. Boosts live in the profile: a private window applies them
 * (scripts only when the boost allows it) but cannot change them.
 */
export class BoostService {
  private readonly pages = new WeakMap<WebContents, PageStyle>();
  /** Pages with a zap tool running. */
  private readonly zapping = new WeakSet<WebContents>();
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: BoostServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? randomUUID;
  }

  list(): Boost[] {
    return [...this.deps.store.list()];
  }

  /**
   * A new document is ready (dom-ready, also in private windows): its CSS from scratch (the previous
   * document's keys died with it), then the scripts allowed there, each in the boosts' isolated world.
   */
  boostPage(contents: WebContents, isPrivate: boolean): void {
    this.styleOf(contents).keys = [];
    void this.restyle(contents);
    for (const boost of boostsFor(this.deps.store.list(), contents.getURL())) {
      if (!scriptAllowed(boost, isPrivate)) continue;
      contents.executeJavaScriptInIsolatedWorld(SCRIPT_WORLD_ID, [{ code: userScript(boost.script.code) }]).catch(() => {});
    }
  }

  /** Replaces the page's boost CSS with the current one (live: no reload). */
  restyle(contents: WebContents): Promise<void> {
    const state = this.styleOf(contents);
    state.queue = state.queue
      .then(async () => {
        if (contents.isDestroyed()) return;
        const css = pageCss(this.deps.store.list(), contents.getURL());
        const old = state.keys.splice(0);
        for (const key of old) await contents.removeInsertedCSS(key).catch(() => {});
        if (css && !contents.isDestroyed()) state.keys.push(await contents.insertCSS(css));
      })
      .catch(() => {});
    return state.queue;
  }

  /** Writes the list (UI, zap tool, sync) and applies it everywhere. */
  setBoosts(next: readonly Boost[]): void {
    this.deps.store.save(next);
    this.refreshAll();
  }

  save(c: WindowPort, input: unknown): BoostResult {
    if (c.isPrivate) return PRIVATE_REFUSAL;
    const given = typeof input === "object" && input !== null ? (input as { id?: unknown }).id : undefined;
    const result = validateBoostInput(input, typeof given === "string" ? given : this.newId(), this.now());
    if (result.ok) this.setBoosts(upsertBoost(this.deps.store.list(), result.boost));
    return result;
  }

  remove(c: WindowPort, id: string): void {
    if (!c.isPrivate) this.setBoosts(this.deps.store.list().filter((boost) => boost.id !== id));
  }

  // --- The tab's site (site panel) -------------------------------------------------------------

  forTab(c: WindowPort, tabId: string): TabBoost | null {
    const url = this.pageUrl(c, tabId);
    const host = url && boostHostOf(url);
    if (!url || !host) return null;
    const contents = c.tabs.pageOf(tabId);
    return { host, boost: siteBoost(this.deps.store.list(), url), isPrivate: c.isPrivate, zapping: !!contents && this.zapping.has(contents) };
  }

  createForTab(c: WindowPort, tabId: string): TabBoost | null {
    const url = this.pageUrl(c, tabId);
    if (url && !c.isPrivate) this.ensureBoost(url);
    return this.forTab(c, tabId);
  }

  /** "Réafficher" in the site panel: the zap removed from the tab's site boost. */
  unzap(c: WindowPort, tabId: string, selector: string): TabBoost | null {
    const url = this.pageUrl(c, tabId);
    const boost = url && siteBoost(this.deps.store.list(), url);
    if (boost && !c.isPrivate) this.setBoosts(upsertBoost(this.deps.store.list(), removeZap(boost, selector, this.now())));
    return this.forTab(c, tabId);
  }

  /**
   * "Masquer des éléments": the zap tool in the tab's page. Each click resolves the script's promise
   * with a selector main validates and saves into the site's boost (created on the first one); the
   * loop ends with Escape or when the page goes away.
   */
  startZap(c: WindowPort, tabId: string): void {
    const contents = c.tabs.pageOf(tabId);
    if (c.isPrivate || !contents || contents.isDestroyed() || this.zapping.has(contents) || !this.pageUrl(c, tabId)) return;
    this.zapping.add(contents);
    c.overlay.close();
    contents.focus();
    void (async () => {
      try {
        while (!contents.isDestroyed()) {
          const result: unknown = await contents.executeJavaScriptInIsolatedWorld(ZAP_WORLD_ID, [{ code: ZAP_SCRIPT }]).catch(() => null);
          const selector = typeof result === "object" && result !== null ? (result as { selector?: unknown }).selector : undefined;
          if (!isValidSelector(selector)) return;
          const boost = this.ensureBoost(contents.getURL());
          if (boost) this.setBoosts(upsertBoost(this.deps.store.list(), addZap(boost, selector, this.now())));
        }
      } finally {
        this.zapping.delete(contents);
      }
    })();
  }

  private styleOf(contents: WebContents): PageStyle {
    let state = this.pages.get(contents);
    if (!state) this.pages.set(contents, (state = { keys: [], queue: Promise.resolve() }));
    return state;
  }

  /** After a change: every open page restyled, every UI told. Scripts apply at the next load. */
  private refreshAll(): void {
    for (const c of this.deps.windows.all()) {
      for (const { manager, tab } of c.spaces.allTabs()) {
        const contents = manager.pageOf(tab.id);
        if (contents && !contents.isDestroyed()) void this.restyle(contents);
      }
      c.send(Channels.boostsChanged);
    }
  }

  private pageUrl(c: WindowPort, tabId: string): string | null {
    const url = c.tabs.getState().tabs.find((tab) => tab.id === tabId)?.url ?? "";
    return boostHostOf(url) ? url : null;
  }

  /** The tab's site boost, created when it has none yet. */
  private ensureBoost(url: string): Boost | null {
    const existing = siteBoost(this.deps.store.list(), url);
    if (existing) return existing;
    const host = boostHostOf(url);
    if (!host) return null;
    const boost = newBoost(this.newId(), host, this.now());
    this.setBoosts(upsertBoost(this.deps.store.list(), boost));
    return this.deps.store.list().some((item) => item.id === boost.id) ? boost : null;
  }
}
