import {
  buildPrompt,
  historyMessages,
  markdownToNodes,
  packSources,
  readerPlainText,
  requestLabel,
  sentSources,
  turnId,
  type AssistantAction,
  type AssistantTurn,
  type HistoryMessage,
} from "@shared/assistant";
import type { ReaderArticle } from "@shared/reader";
import { readerBlocks, type ReaderBlock } from "./reader";

/**
 * The AI assistant on the phone (ADR-044): the same pure core as the desktop. The page's text
 * comes from the reader injection (token per request, answer validated by the shared sanitizer,
 * `./reader`); the key lives in `expo-secure-store`; conversations stay in memory, per tab.
 */

export type MobileAssistantAction = Extract<AssistantAction, "summarize" | "key-points" | "ask">;

interface SecretStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: object): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const KEY_NAME = "assistant.anthropic-key";

/** The Anthropic API key (never synced, never shown again). */
export class AssistantKey {
  private cache: string | null = null;

  constructor(
    private readonly store: SecretStore,
    private readonly options?: object,
  ) {}

  async get(): Promise<string> {
    if (this.cache === null) this.cache = (await this.store.getItemAsync(KEY_NAME).catch(() => null)) ?? "";
    return this.cache;
  }

  async set(key: string): Promise<void> {
    const clean = key.trim().slice(0, 500);
    if (clean) await this.store.setItemAsync(KEY_NAME, clean, this.options);
    else await this.store.deleteItemAsync(KEY_NAME);
    this.cache = clean;
  }
}

/** A conversation of one tab (in memory). */
export interface MobileConversation {
  tabId: string;
  url: string;
  turns: AssistantTurn[];
}

/**
 * Appends the user's turn (with the page when `article` is given and the conversation has not
 * sent it yet) and returns the messages to send.
 */
export function addRequest(
  conversation: MobileConversation,
  action: MobileAssistantAction,
  article: ReaderArticle | null,
  question?: string,
): { conversation: MobileConversation; messages: HistoryMessage[] } {
  const sentAlready = conversation.turns.some((turn) => turn.sent?.some((source) => source.url === article?.url && !source.empty));
  const sources = article && !(action === "ask" && sentAlready) ? [{ title: article.title || article.url, url: article.url, text: readerPlainText(article.content) }] : [];
  const packed = packSources(sources);
  const turn: AssistantTurn = {
    id: turnId(conversation.turns.length + 1),
    role: "user",
    text: requestLabel(action, question),
    prompt: buildPrompt({ action, question, sources: packed }),
    sent: sentSources(packed),
    ...(action === "ask" && article && sentAlready ? { reusedContext: true } : {}),
  };
  const turns = [...conversation.turns, turn];
  return { conversation: { ...conversation, turns }, messages: historyMessages(turns) };
}

/** The answer drawn natively: Markdown → sanitized reader tree → native blocks. */
export const answerBlocks = (markdown: string): ReaderBlock[] => readerBlocks(markdownToNodes(markdown));
