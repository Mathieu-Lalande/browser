import { finalStatus, REFUSAL_MESSAGE, TRUNCATED_NOTE, type AssistantTurn } from "@shared/assistant";
import type { ReaderArticle } from "@shared/reader";
import type { Settings, SettingsPatch } from "@shared/settings";
import { useRef, useState } from "react";
import { addRequest, type MobileAssistantAction, type MobileConversation } from "../lib/assistant";
import { askClaude, errorMessage, isAbort } from "../lib/assistantClient";
import { isPrivateTab, type MobileTab } from "../lib/tabs";
import { assistantKey } from "../state/assistant";
import { useEvent } from "./useEvent";

interface Pending {
  action: MobileAssistantAction;
  question?: string;
  includePage: boolean;
}

/**
 * The assistant sheet's logic (ADR-044): one in-memory conversation per tab (a new page starts
 * a new one), the privacy notice first (once; each session for private tabs), the page's text
 * read through the reader injection (`requestArticle`, token per request), then one API call.
 */
export function useAssistant({
  tab,
  settings,
  updateSettings,
  requestArticle,
}: {
  tab: MobileTab | null;
  settings: Settings["assistant"];
  updateSettings: (patch: SettingsPatch) => void;
  requestArticle: (tabId: string) => void;
}) {
  const [shown, setShown] = useState(false);
  const [conversations, setConversations] = useState<Record<string, MobileConversation>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [waitingConsent, setWaitingConsent] = useState(false);
  const [privateConsent, setPrivateConsent] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);

  const isPrivate = !!tab && isPrivateTab(tab);
  const needsConsent = isPrivate ? !privateConsent : !settings.acknowledged;
  const current = tab ? conversations[tab.id] : undefined;
  const conversation = current && (current.url === tab?.url || settings.keepConversations) ? current : null;

  const update = (tabId: string, change: (turns: AssistantTurn[]) => AssistantTurn[]) =>
    setConversations((all) => (all[tabId] ? { ...all, [tabId]: { ...all[tabId], turns: change(all[tabId].turns) } } : all));

  const send = useEvent(async (request: Pending, article: ReaderArticle | null) => {
    if (!tab) return;
    const apiKey = await assistantKey.get();
    const base = conversation ?? { tabId: tab.id, url: tab.url, turns: [] };
    const { conversation: next, messages } = addRequest({ ...base, url: tab.url }, request.action, request.includePage ? article : null, request.question);
    const answer: AssistantTurn = { id: `a${next.turns.length + 1}`, role: "assistant", text: "", status: "streaming", model: settings.model };
    setConversations((all) => ({ ...all, [tab.id]: { ...next, turns: [...next.turns, answer] } }));
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    const finish = (patch: Partial<AssistantTurn>) => update(tab.id, (turns) => turns.map((turn) => (turn.id === answer.id ? { ...turn, ...patch } : turn)));
    try {
      if (!apiKey) throw new Error("no key");
      const progress = await askClaude(apiKey, settings.model, messages, controller.signal);
      const status = finalStatus(progress);
      finish({ text: progress.text, status, error: status === "refused" ? REFUSAL_MESSAGE : status === "truncated" ? TRUNCATED_NOTE : undefined });
    } catch (error) {
      if (isAbort(error)) finish({ status: "stopped" });
      else finish({ status: "error", error: apiKey ? errorMessage(error) : "Ajoutez votre clé d'API Anthropic dans les paramètres." });
    } finally {
      if (abort.current === controller) abort.current = null;
      setBusy(false);
    }
  });

  /** Runs a request: the notice first, then the page's text (when it goes along), then the call. */
  const run = useEvent((request: Pending) => {
    if (!tab || busy) return;
    setPending(request);
    if (needsConsent) return setWaitingConsent(true);
    const sentAlready = conversation?.turns.some((turn) => turn.sent?.some((source) => source.url === tab.url));
    if (request.includePage && !(request.action === "ask" && sentAlready)) requestArticle(tab.id);
    else {
      setPending(null);
      void send(request, null);
    }
  });

  const accept = useEvent(() => {
    if (isPrivate) setPrivateConsent(true);
    else updateSettings({ assistant: { acknowledged: true } });
    setWaitingConsent(false);
    const request = pending;
    if (request && tab) {
      if (request.includePage) requestArticle(tab.id);
      else {
        setPending(null);
        void send(request, null);
      }
    }
  });

  /** The reader extraction answered (null: nothing readable). */
  const onArticle = useEvent((tabId: string, article: ReaderArticle | null) => {
    const request = pending;
    setPending(null);
    if (!request || tabId !== tab?.id) return;
    if (!article && request.action !== "ask") {
      const id = `e${Date.now()}`;
      setConversations((all) => {
        const base = all[tabId] ?? { tabId, url: tab.url, turns: [] };
        return { ...all, [tabId]: { ...base, turns: [...base.turns, { id, role: "assistant", text: "", status: "error", error: "Aucun texte lisible sur cette page." }] } };
      });
      return;
    }
    void send(request, article);
  });

  return {
    shown,
    open: useEvent(() => setShown(true)),
    close: useEvent(() => setShown(false)),
    clear: useEvent(() => tab && setConversations((all) => ({ ...all, [tab.id]: { tabId: tab.id, url: tab.url, turns: [] } }))),
    stop: useEvent(() => abort.current?.abort()),
    run,
    accept,
    onArticle,
    turns: conversation?.turns ?? [],
    busy,
    isPrivate,
    waitingConsent: waitingConsent && needsConsent,
    pendingLabel: pending ? (pending.action === "ask" ? pending.question ?? "" : pending.action === "summarize" ? "Résumer la page" : "Points clés") : null,
  };
}

export type AssistantController = ReturnType<typeof useAssistant>;
