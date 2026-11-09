import { t } from "@shared/i18n";
import { app, type WebContents } from "electron";
import { pageLanguage, targetLanguage } from "@shared/translate/languages";
import { createProvider, TranslationError, type ProviderConfig, type TranslateProviderId } from "@shared/translate/providers";
import {
  isNeverSite,
  siteOfUrl,
  translateDecision,
  withAlwaysLanguage,
  withNeverSite,
  type TranslateRules,
} from "@shared/translate/rules";
import type { TabTranslation, TranslatePanelState, TranslateResultMessage, TranslateRuleChange } from "@shared/translate/state";
import { testTranslation, Translator } from "@shared/translate/translator";
import type { Bounds, TabId } from "@shared/types";
import { settings, updateSettings } from "../settings";
import type { BrowserController } from "../window";
import { fetchHttp } from "./http";
import { translateKeys } from "./keys";
import { declaredLanguage, restoreOriginal } from "./page";
import { TranslationRun } from "./run";

/**
 * Page translation, desktop side (ADR-036). Off until the user picks a provider in the settings:
 * the page's text is then sent to it, by main only (`./http`), after a privacy notice accepted
 * once (normal windows) or once per private window. Each window has a `PageTranslator` that
 * follows its tabs' documents: the declared language after each `dom-ready`, the rules (always
 * this language, never this site), the run in progress and what the UIs show (`TabTranslation`).
 */

const PRIVATE_NOTICE = t("translateIndex.privateWindowConfirmSending");

/** The UI/system languages, for the default target. */
function preferredLanguages(): string[] {
  return [...app.getPreferredSystemLanguages(), app.getLocale()];
}

export function currentTarget(): string {
  return targetLanguage(settings().translate.target, preferredLanguages());
}

/** The configured provider's settings and key (throws a French `config` error when incomplete). */
function providerConfig(): ProviderConfig {
  const current = settings().translate;
  if (current.provider === "none") throw new TranslationError("config", t("translateIndex.chooseTranslationServiceSettings"));
  return { provider: current.provider, apiKey: translateKeys.get(current.provider), deeplPlan: current.deeplPlan, libreUrl: current.libreUrl };
}

/** One `Translator` (and its cache) while the configuration stays the same. */
let shared: { signature: string; translator: Translator } | null = null;

function currentTranslator(): Translator {
  const config = providerConfig();
  const signature = JSON.stringify(config);
  if (shared?.signature !== signature) shared = { signature, translator: new Translator(createProvider(config), fetchHttp) };
  return shared.translator;
}

function isConfigured(): boolean {
  try {
    createProvider(providerConfig());
    return true;
  } catch {
    return false;
  }
}

const message = (error: unknown) => (error instanceof TranslationError ? error.message : t("translateIndex.translationFailed"));

/** "Tester" in the settings: a short sample through the configured provider. */
export async function testProvider(): Promise<TranslateResultMessage> {
  try {
    const sample = await testTranslation(currentTranslator(), currentTarget());
    return { ok: true, message: t("translateIndex.works", { sample }) };
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}

export const keysStatus = () => translateKeys.status();

export function setProviderKey(provider: TranslateProviderId, key: string): TranslateResultMessage {
  const result = translateKeys.set(provider, key);
  return result.ok ? { ok: true, message: key.trim() ? t("translateIndex.keySaved") : t("translateIndex.keyDeleted") } : result;
}

interface TabEntry {
  contents: WebContents;
  translation: TabTranslation;
  run: TranslationRun | null;
}

export class PageTranslator {
  private readonly tabs = new Map<TabId, TabEntry>();
  private readonly watched = new WeakSet<WebContents>();
  /** Private window (ADR-014): consent for this window only, rules kept in memory. */
  private privateConsent = false;
  private privateRules: TranslateRules | null = null;

  constructor(private readonly c: BrowserController) {}

  /** What the tab's state carries (TabManager hook). */
  stateOf(tabId: TabId): TabTranslation | null {
    return this.tabs.get(tabId)?.translation ?? null;
  }

  private get rules(): TranslateRules {
    const { alwaysLanguages, neverLanguages, neverSites } = settings().translate;
    if (this.c.isPrivate) return (this.privateRules ??= { alwaysLanguages, neverLanguages, neverSites });
    return { alwaysLanguages, neverLanguages, neverSites };
  }

  private get needsConsent(): boolean {
    return this.c.isPrivate ? !this.privateConsent : !settings().translate.acknowledged;
  }

  private refresh(): void {
    this.c.spaces.refresh();
  }

  private pageOf(tabId: TabId): WebContents | null {
    for (const manager of this.c.spaces.tabManagers()) {
      const contents = manager.pageOf(tabId);
      if (contents) return contents;
    }
    return null;
  }

  /** A new document in a tab (dom-ready): forget the previous one, read its language, apply the rules. */
  async pageReady(tabId: TabId, contents: WebContents): Promise<void> {
    const previous = this.tabs.get(tabId);
    previous?.run?.cancel();
    this.tabs.delete(tabId);
    const current = settings().translate;
    if (current.provider === "none" || !/^https?:/.test(contents.getURL())) {
      if (previous) this.refresh();
      return;
    }
    const url = contents.getURL();
    const language = pageLanguage((await declaredLanguage(contents)) ?? {});
    if (contents.isDestroyed() || contents.getURL() !== url || this.tabs.has(tabId)) return;
    const to = currentTarget();
    const decision = translateDecision({ pageLanguage: language, target: to, site: siteOfUrl(url), rules: this.rules });
    this.track(tabId, {
      contents,
      run: null,
      translation: { pageLanguage: language, from: null, to, status: "idle", offer: decision !== "none" && current.offer },
    });
    if (decision === "auto" && !this.needsConsent) void this.translate(tabId, language, to);
    else this.refresh();
  }

  /** The entry of a tab's live page (created on demand: translation asked before any rule ran). */
  private entryOf(tabId: TabId): TabEntry | null {
    const contents = this.pageOf(tabId);
    if (!contents || !/^https?:/.test(contents.getURL())) return null;
    const existing = this.tabs.get(tabId);
    if (existing && existing.contents === contents) return existing;
    existing?.run?.cancel();
    return this.track(tabId, { contents, run: null, translation: { pageLanguage: null, from: null, to: currentTarget(), status: "idle", offer: false } });
  }

  /** Keeps `entry` for the tab until its page goes. */
  private track(tabId: TabId, entry: TabEntry): TabEntry {
    this.tabs.set(tabId, entry);
    if (!this.watched.has(entry.contents)) {
      this.watched.add(entry.contents);
      entry.contents.once("destroyed", () => {
        if (this.tabs.get(tabId)?.contents === entry.contents) this.tabs.delete(tabId);
      });
    }
    return entry;
  }

  /**
   * Translates the tab's page from `from` (null: detected by the provider) to `to`. `consent`: the
   * user accepted the privacy notice just now (the popover's button).
   */
  async translate(tabId: TabId, from: string | null, to: string, consent = false): Promise<TranslateResultMessage> {
    const entry = this.entryOf(tabId);
    if (!entry) return { ok: false, message: t("translateIndex.pageCantTranslated") };
    if (consent) this.consent();
    if (this.needsConsent) return { ok: false, message: this.c.isPrivate ? PRIVATE_NOTICE : t("translateIndex.acceptSendingTextTranslation") };
    let translator: Translator;
    try {
      translator = currentTranslator();
    } catch (error) {
      entry.translation = { ...entry.translation, status: "error", error: message(error) };
      this.refresh();
      return { ok: false, message: message(error) };
    }
    entry.run?.cancel();
    if (entry.translation.status !== "idle") await restoreOriginal(entry.contents);
    // Resolves once the first batch is in the page (or nothing was left to translate), or on a
    // failure; the run itself goes on (the rest of the page, then new content).
    return new Promise<TranslateResultMessage>((resolve) => {
      let applied = false;
      const started = () => {
        if (!applied && entry.run === run) {
          applied = true;
          entry.translation = { ...entry.translation, status: "translated" };
          this.refresh();
        }
        resolve({ ok: true, message: "" });
      };
      const run: TranslationRun = new TranslationRun(entry.contents, translator, from, to, {
        detected: (language) => {
          entry.translation = { ...entry.translation, from: language };
          this.refresh();
        },
        applied: started,
        drained: started,
      });
      entry.run = run;
      entry.translation = { ...entry.translation, from, to, status: "translating", error: undefined };
      this.refresh();
      run.run().then(started, async (error: unknown) => {
        resolve({ ok: false, message: message(error) });
        if (entry.run !== run) return;
        run.cancel();
        entry.run = null;
        // Keep what was translated already; nothing at all: back to the original.
        if (!applied) await restoreOriginal(entry.contents);
        entry.translation = { ...entry.translation, status: applied ? "translated" : "error", error: message(error) };
        this.refresh();
      });
    });
  }

  /** "Afficher l'original". */
  async restore(tabId: TabId): Promise<void> {
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    entry.run?.cancel();
    entry.run = null;
    await restoreOriginal(entry.contents);
    entry.translation = { ...entry.translation, status: "idle", error: undefined };
    this.refresh();
  }

  /** The command, the app menu and the page menu: translate, or show the original back. */
  async toggle(tabId: TabId): Promise<void> {
    const status = this.tabs.get(tabId)?.translation.status;
    if (status === "translated" || status === "translating") return this.restore(tabId);
    // Something to confirm or to set up first: the popover explains it.
    if (this.needsConsent || !isConfigured()) return this.showPopover(tabId);
    if (this.c.overlay.shown && this.c.overlay.shown !== "translate") this.c.overlay.close(true);
    const entry = this.entryOf(tabId);
    if (entry) await this.translate(tabId, entry.translation.pageLanguage, entry.translation.to);
  }

  /** The popover, hanging from `anchor` (the address bar's button), else from the page's top right. */
  showPopover(tabId: TabId | null = this.c.tabs.activeTabId, anchor?: Bounds): void {
    if (!tabId || !this.entryOf(tabId)) return;
    const { x, y, width } = this.c.tabs.viewBounds;
    this.c.overlay.open({ kind: "translate", tabId, anchor: anchor ?? { x: x + Math.max(0, width - 340), y, width: 0, height: 0 } });
  }

  panelState(tabId: TabId): TranslatePanelState | null {
    const entry = this.entryOf(tabId);
    if (!entry) return null;
    const site = siteOfUrl(entry.contents.getURL());
    const language = entry.translation.pageLanguage ?? entry.translation.from;
    const rules = this.rules;
    return {
      site,
      translation: entry.translation,
      provider: settings().translate.provider,
      configured: isConfigured(),
      needsConsent: this.needsConsent,
      isPrivate: this.c.isPrivate,
      alwaysLanguage: !!language && rules.alwaysLanguages.includes(language),
      neverSite: isNeverSite(rules, site),
    };
  }

  private consent(): void {
    if (this.c.isPrivate) this.privateConsent = true;
    else if (!settings().translate.acknowledged) updateSettings({ translate: { acknowledged: true } });
  }

  /** "Toujours traduire cette langue" / "Jamais pour ce site" (a private window keeps them in memory). */
  async setRule(tabId: TabId, change: TranslateRuleChange, on: boolean): Promise<TranslatePanelState | null> {
    const entry = this.entryOf(tabId);
    if (!entry) return null;
    let rules = this.rules;
    if (change === "always-language") {
      const language = entry.translation.pageLanguage ?? entry.translation.from;
      if (!language) return this.panelState(tabId);
      rules = withAlwaysLanguage(rules, language, on);
    } else {
      const site = siteOfUrl(entry.contents.getURL());
      if (!site) return this.panelState(tabId);
      rules = withNeverSite(rules, site, on);
      entry.translation = { ...entry.translation, offer: !on && entry.translation.offer };
      if (on) await this.restore(tabId);
    }
    if (this.c.isPrivate) this.privateRules = rules;
    else updateSettings({ translate: rules });
    this.refresh();
    return this.panelState(tabId);
  }
}
