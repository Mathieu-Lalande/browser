import { sanitizeReaderArticle } from "@shared/reader";
import { addRequest, answerBlocks, AssistantKey } from "./assistant";

const article = sanitizeReaderArticle({ title: "Licornes", content: [{ tag: "p", children: ["La licorne a une corne unique."] }] }, "https://a.test/")!;

describe("assistant on the phone", () => {
  it("sends the page once, then follow-ups reuse it", () => {
    const first = addRequest({ tabId: "t", url: article.url, turns: [] }, "summarize", article);
    expect(first.messages).toHaveLength(1);
    expect(first.messages[0].content).toContain('<page index="1" title="Licornes"');
    expect(first.conversation.turns[0].sent).toEqual([{ title: "Licornes", url: "https://a.test/", truncated: false }]);
    const answered = { ...first.conversation, turns: [...first.conversation.turns, { id: "a", role: "assistant" as const, text: "Résumé.", status: "done" as const }] };
    const next = addRequest(answered, "ask", article, "Pourquoi ?");
    expect(next.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(next.messages[2].content).toBe("Pourquoi ?");
    expect(next.conversation.turns[2].reusedContext).toBe(true);
  });

  it("draws Markdown as native blocks", () => {
    expect(answerBlocks("## Titre\n\nUn **gras**.")).toEqual([
      { kind: "heading", level: 3, spans: [{ text: "Titre" }] },
      { kind: "paragraph", spans: [{ text: "Un " }, { text: "gras", bold: true }, { text: "." }] },
    ]);
  });

  it("keeps the key in the secure store", async () => {
    const items = new Map<string, string>();
    const store = {
      getItemAsync: async (key: string) => items.get(key) ?? null,
      setItemAsync: async (key: string, value: string) => void items.set(key, value),
      deleteItemAsync: async (key: string) => void items.delete(key),
    };
    const key = new AssistantKey(store);
    await key.set("  sk-ant-x  ");
    expect(await new AssistantKey(store).get()).toBe("sk-ant-x");
    await key.set("");
    expect(items.size).toBe(0);
  });
});
