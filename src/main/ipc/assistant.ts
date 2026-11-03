import { sanitizeAssistantRequest, type AssistantRequest } from "@shared/assistant/conversation";
import { Channels } from "@shared/ipc";
import { keyStatus, setKey, testAssistant } from "../assistant";
import { custom, defineHandlers, handle, handleUi, maxStr, on, str } from "./registry";

/**
 * The AI assistant (ADR-044): the UIs name tabs of their own window and turns by id; requests are
 * validated (`sanitizeAssistantRequest`), page text is read by main, never sent by a UI, and the
 * key only goes in.
 */
const request = custom<AssistantRequest>((value) => sanitizeAssistantRequest(value) !== null);
const id = maxStr(64);

export const assistantHandlers = defineHandlers({
  [Channels.assistantState]: handle([id], (c, tabId) => c.assistant.state(tabId)),
  [Channels.assistantAsk]: handle([id, request], (c, tabId, value) => c.assistant.ask(tabId, sanitizeAssistantRequest(value)!)),
  [Channels.assistantOpen]: on([request], (c, value) => void c.assistant.open(sanitizeAssistantRequest(value)!)),
  [Channels.assistantAccept]: handle([id], (c, tabId) => c.assistant.accept(tabId)),
  [Channels.assistantStop]: on([id], (c, tabId) => c.assistant.stop(tabId)),
  [Channels.assistantClear]: on([id], (c, tabId) => c.assistant.clear(tabId)),
  [Channels.assistantCopy]: on([id, str], (c, tabId, turn) => c.assistant.copy(tabId, turn)),
  [Channels.assistantInsertNote]: handle([id, str], (c, tabId, turn) => c.assistant.insertNote(tabId, turn)),
  [Channels.assistantKey]: handleUi([], () => keyStatus()),
  [Channels.assistantSetKey]: handle([maxStr(500)], (_c, key) => setKey(key), { privateRefused: true }),
  [Channels.assistantTest]: handleUi([], () => testAssistant()),
});
