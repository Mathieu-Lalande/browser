import { clipboard, type WebContents } from "electron";
import { ANNOTATION_LIMITS } from "@shared/annotations/model";
import {
  packSources,
  SELECTION_TOKEN_BUDGET,
  sentSources,
  truncateToTokens,
  type ContextSource,
  type PackedSource,
} from "@shared/assistant/context";
import { historyMessages, turnId, viewTurn, type AssistantRequest, type AssistantTurn } from "@shared/assistant/conversation";
import { buildPrompt, requestLabel, usesSelection } from "@shared/assistant/prompts";
import { PRIVATE_NOTICE, type AssistantKeyStatus, type AssistantPanelState, type AssistantResult } from "@shared/assistant/state";
import { finalStatus, REFUSAL_MESSAGE, TRUNCATED_NOTE } from "@shared/assistant/stream";
import { Channels } from "@shared/ipc";
import { languageName } from "@shared/translate/languages";
import type { TabId } from "@shared/types";
import { settings, updateSettings } from "../settings";
import { currentTarget } from "../translate";
import type { BrowserController } from "../window";
import { errorMessage, isAbort, streamAnswer, testKey } from "./client";
import { assistantKey } from "./keys";
import { readPage, readSelection } from "./page";

/**
 * The AI assistant, desktop side (ADR-044). Off until enabled in the settings with the user's
 * own Anthropic key; nothing is sent without a user action, and the first request (each one of
 * a private window until confirmed there) waits for the privacy notice. Each window keeps one
 * conversation per tab, in memory only: a new page starts a new one unless the user keeps them,
 * and a private window's go with it. Answers stream into the conversation; the UIs are told a
 * tab changed (`assistant:changed`) and read its state back.
 */

const isWeb = (url: string) => /^https?:/i.test(url);
/** UI refreshes while an answer streams. */
const NOTIFY_DELAY_MS = 40;

interface Conversation {
  url: string;
  turns: AssistantTurn[];
  sequence: number;
  abort: AbortController | null;
  /** A request waiting for the privacy notice. */
  pending: AssistantRequest | null;
}

export const keyStatus = (): AssistantKeyStatus => assistantKey.status();

export function setKey(key: string): AssistantResult {
  const result = assistantKey.set(key);
  return result.ok ? { ok: true, message: key.trim() ? "Clé enregistrée." : "Clé supprimée." } : result;
}

/** "Tester" in the settings. */
export async function testAssistant(): Promise<AssistantResult> {
  const key = assistantKey.get();
  if (!key) return { ok: false, message: "Enregistrez d'abord une clé d'API." };
  try {
    await testKey(key, settings().assistant.model);
    return { ok: true, message: "Fonctionne : la clé est acceptée." };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

export class PageAssistant {
  private readonly conversations = new Map<TabId, Conversation>();
  /** Private window (ADR-014): the notice is confirmed for this window only. */
  private privateConsent = false;
  private readonly dirty = new Set<TabId>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly c: BrowserController) {}

  private get needsConsent(): boolean {
    return this.c.isPrivate ? !this.privateConsent : !settings().assistant.acknowledged;
  }

  private pageOf(tabId: TabId): WebContents | null {
    for (const manager of this.c.spaces.tabManagers()) {
      const contents = manager.pageOf(tabId);
      if (contents) return contents;
    }
    return null;
  }

  private tabExists(tabId: TabId): boolean {
    return this.c.spaces.tabManagers().some((manager) => manager.getState().tabs.some((tab) => tab.id === tabId));
  }

  private notify(tabId: TabId, now = false): void {
    this.dirty.add(tabId);
    const flush = () => {
      this.timer = null;
      for (const id of this.dirty) this.c.send(Channels.assistantChanged, id);
      this.dirty.clear();
    };
    if (now) {
      if (this.timer) clearTimeout(this.timer);
      flush();
    } else this.timer ??= setTimeout(flush, NOTIFY_DELAY_MS);
  }

  /** The tab's conversation for its current page (a new page starts a new one unless kept). */
  private conversation(tabId: TabId): Conversation {
    const url = this.pageOf(tabId)?.getURL() ?? "";
    let conversation = this.conversations.get(tabId);
    if (conversation && conversation.url !== url && !conversation.abort && !settings().assistant.keepConversations) {
      this.conversations.delete(tabId);
      conversation = undefined;
    }
    if (!conversation) {
      conversation = { url, turns: [], sequence: 0, abort: null, pending: null };
      this.conversations.set(tabId, conversation);
    }
    conversation.url = url;
    return conversation;
  }

  state(tabId: TabId): AssistantPanelState {
    const current = settings().assistant;
    const conversation = this.conversations.has(tabId) || isWeb(this.pageOf(tabId)?.getURL() ?? "") ? this.conversation(tabId) : null;
    return {
      enabled: current.enabled,
      configured: !!assistantKey.get(),
      needsConsent: this.needsConsent,
      isPrivate: this.c.isPrivate,
      model: current.model,
      readable: isWeb(this.pageOf(tabId)?.getURL() ?? ""),
      running: !!conversation?.abort,
      turns: conversation?.turns.map(viewTurn) ?? [],
      pending: conversation?.pending ? requestLabel(conversation.pending.action, conversation.pending.question) : null,
    };
  }

  /** Shows the panel and asks (omnibox `@ia`, page menu). */
  open(request: AssistantRequest, tabId: TabId | null = this.c.tabs.activeTabId): Promise<AssistantResult> {
    this.c.sendUiCommand("open-assistant");
    if (!tabId) return Promise.resolve({ ok: false, message: "Aucun onglet." });
    return this.ask(tabId, request);
  }

  /** Sends a request about the tab (and, to compare, other tabs): resolves once the answer started. */
  async ask(tabId: TabId, request: AssistantRequest): Promise<AssistantResult> {
    const current = settings().assistant;
    if (!current.enabled) return { ok: false, message: "Activez l'assistant dans Paramètres → Assistant IA." };
    const apiKey = assistantKey.get();
    if (!apiKey) return { ok: false, message: "Ajoutez votre clé d'API Anthropic dans Paramètres → Assistant IA." };
    for (const id of this.conversations.keys()) if (id !== tabId && !this.tabExists(id)) this.conversations.delete(id);
    const conversation = this.conversation(tabId);
    if (request.consent) this.consent();
    if (this.needsConsent) {
      conversation.pending = { ...request, consent: undefined };
      this.notify(tabId, true);
      return { ok: false, needsConsent: true, message: this.c.isPrivate ? PRIVATE_NOTICE : "Acceptez d'abord l'envoi à Anthropic." };
    }
    conversation.pending = null;
    conversation.abort?.abort();

    const contents = this.pageOf(tabId);
    const pageUrl = contents?.getURL() ?? "";
    const wantsPage = request.action !== "compare-tabs" && request.action !== "translate-selection" && (request.action !== "ask" || request.includePage !== false);
    if ((wantsPage || usesSelection(request.action)) && (!contents || !isWeb(pageUrl))) {
      this.notify(tabId, true);
      return { ok: false, message: "L'assistant lit les pages web : ouvrez-en une." };
    }

    let selection: { text: string; truncated: boolean } | null = null;
    if (usesSelection(request.action)) {
      const text = (await readSelection(contents!)).trim();
      if (!text) return { ok: false, message: "Sélectionnez d'abord un passage de la page." };
      selection = truncateToTokens(text, SELECTION_TOKEN_BUDGET);
    }

    // A question about a page this conversation already sent: its text is in the history.
    const alreadySent = conversation.turns.some((turn) => turn.role === "user" && turn.sent?.some((source) => source.url === pageUrl && !source.empty));
    const sources: ContextSource[] = [];
    if (request.action === "compare-tabs") {
      for (const id of request.tabIds ?? []) {
        const page = this.pageOf(id);
        if (page && isWeb(page.getURL())) sources.push(await readPage(page));
        else {
          const tab = this.c.spaces.tabManagers().flatMap((manager) => manager.getState().tabs).find((entry) => entry.id === id);
          if (tab) sources.push({ title: tab.title || tab.url, url: tab.url, text: "" });
        }
      }
      if (sources.filter((source) => source.text).length < 2) return { ok: false, message: "Il faut au moins deux onglets chargés à comparer." };
    } else if (wantsPage && !(request.action === "ask" && alreadySent)) {
      sources.push(await readPage(contents!));
    }
    const packed: PackedSource[] = packSources(sources);
    const prompt = buildPrompt({
      action: request.action,
      question: request.question,
      sources: packed,
      selection,
      language: languageName(currentTarget()),
    });

    const user: AssistantTurn = { id: turnId(++conversation.sequence), role: "user", text: requestLabel(request.action, request.question), prompt, sent: sentSources(packed) };
    if (request.action === "ask" && wantsPage && alreadySent) user.reusedContext = true;
    const answer: AssistantTurn = { id: turnId(++conversation.sequence), role: "assistant", text: "", status: "streaming", model: current.model };
    conversation.turns.push(user);
    const messages = historyMessages(conversation.turns);
    conversation.turns.push(answer);
    const abort = new AbortController();
    conversation.abort = abort;
    this.notify(tabId, true);

    void streamAnswer({
      apiKey,
      model: current.model,
      messages,
      signal: abort.signal,
      onProgress: (progress) => {
        answer.text = progress.text;
        this.notify(tabId);
      },
    }).then(
      (progress) => {
        answer.text = progress.text;
        answer.status = finalStatus(progress);
        if (answer.status === "refused") answer.error = REFUSAL_MESSAGE;
        if (answer.status === "truncated") answer.error = TRUNCATED_NOTE;
      },
      (error: unknown) => {
        answer.status = isAbort(error) ? "stopped" : "error";
        if (answer.status === "error") answer.error = errorMessage(error);
      },
    ).finally(() => {
      if (conversation.abort === abort) conversation.abort = null;
      this.notify(tabId, true);
    });
    return { ok: true, message: "" };
  }

  /** "Accepter et envoyer" on the privacy notice: the waiting request goes. */
  accept(tabId: TabId): Promise<AssistantResult> {
    const pending = this.conversations.get(tabId)?.pending;
    this.consent();
    if (!pending) {
      this.notify(tabId, true);
      return Promise.resolve({ ok: true, message: "" });
    }
    return this.ask(tabId, pending);
  }

  stop(tabId: TabId): void {
    this.conversations.get(tabId)?.abort?.abort();
  }

  /** "Nouvelle conversation". */
  clear(tabId: TabId): void {
    this.conversations.get(tabId)?.abort?.abort();
    this.conversations.delete(tabId);
    this.notify(tabId, true);
  }

  private answer(tabId: TabId, id: string): AssistantTurn | null {
    const turn = this.conversations.get(tabId)?.turns.find((entry) => entry.id === id);
    return turn?.role === "assistant" && turn.text.trim() ? turn : null;
  }

  copy(tabId: TabId, id: string): void {
    const turn = this.answer(tabId, id);
    if (turn) clipboard.writeText(turn.text);
  }

  /** "Ajouter aux notes": the answer is appended to the page's note (ADR-037). */
  insertNote(tabId: TabId, id: string): AssistantResult {
    const turn = this.answer(tabId, id);
    const page = this.c.annotator.forTab(tabId);
    if (!turn || !page) return { ok: false, message: "Les notes sont disponibles sur les pages web." };
    const note = (page.note.trim() ? `${page.note.trimEnd()}\n\n${turn.text.trim()}` : turn.text.trim()).slice(0, ANNOTATION_LIMITS.pageNote);
    this.c.annotator.setNote(page.url, note, page.title);
    return { ok: true, message: page.isPrivate ? "Ajoutée aux notes de cette fenêtre privée." : "Ajoutée aux notes de la page." };
  }

  private consent(): void {
    if (this.c.isPrivate) this.privateConsent = true;
    else if (!settings().assistant.acknowledged) updateSettings({ assistant: { acknowledged: true } });
  }
}
