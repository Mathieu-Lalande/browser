import { DEFAULT_SETTINGS } from "@shared/settings";
import { TRANSLATE_WALKER } from "@shared/translate/page-script";
import { applyScript, providerConfig, restoreScript, TRANSLATE_MESSAGE, TranslateBridge, TranslateKeys, translateNonce, translatorFor } from "./translate";

const message = (nonce: string, segments: unknown) => JSON.stringify({ type: TRANSLATE_MESSAGE, nonce, segments });

describe("translate bridge", () => {
  const page = "https://news.example.com/article";

  it("injects the shared walker with a fresh nonce per request", () => {
    let n = 0;
    const bridge = new TranslateBridge(() => `nonce${++n}`);
    const script = bridge.start(page)!;
    expect(script).toContain(TRANSLATE_WALKER);
    expect(script).toContain('"nonce1"');
    expect(bridge.apply([[1, "Bonjour"]])).toBe(applyScript("nonce1", [[1, "Bonjour"]]));
    expect(bridge.start(page)).toContain('"nonce2"');
    expect(new TranslateBridge(() => "x").start("about:blank")).toBeNull();
  });

  it("accepts this document's batches only, validated", () => {
    const bridge = new TranslateBridge(() => "n1");
    bridge.start(page);
    expect(bridge.parse(message("n1", [[1, "Hello"], [2, ""], ["3", "x"]]), page, page)).toEqual([{ id: 1, text: "Hello" }]);
    // Other bridge messages are not translation messages.
    expect(bridge.parse(JSON.stringify({ type: "browser-reader" }), page, page)).toBeUndefined();
    // Wrong nonce, or a frame of another origin.
    expect(bridge.parse(message("guess", [[1, "Hello"]]), page, page)).toBeNull();
    expect(bridge.parse(message("n1", [[1, "Hello"]]), "https://ads.example.net/frame", page)).toBeNull();
    // A new document, or the original restored: nothing is accepted any more.
    bridge.loadStarted();
    expect(bridge.parse(message("n1", [[1, "Hello"]]), page, page)).toBeNull();
    bridge.start(page);
    expect(bridge.restore()).toBe(restoreScript("n1"));
    expect(bridge.active).toBe(false);
    expect(bridge.parse(message("n1", [[1, "Hello"]]), page, page)).toBeNull();
  });

  it("makes 128-bit nonces", () => {
    expect(translateNonce((length) => new Uint8Array(length).fill(255))).toBe("f".repeat(32));
  });
});

describe("translation setup", () => {
  it("keeps keys in the secure store", async () => {
    const values = new Map<string, string>();
    const store = {
      getItemAsync: async (key: string) => values.get(key) ?? null,
      setItemAsync: async (key: string, value: string) => void values.set(key, value),
      deleteItemAsync: async (key: string) => void values.delete(key),
    };
    const keys = new TranslateKeys(store);
    expect(await keys.get("deepl")).toBe("");
    await keys.set("deepl", " secret:fx ");
    expect(values.get("translate.key.deepl")).toBe("secret:fx");
    expect(await new TranslateKeys(store).get("deepl")).toBe("secret:fx");
    await keys.set("deepl", "");
    expect(values.has("translate.key.deepl")).toBe(false);
  });

  it("is off by default, and translates through the shared providers", async () => {
    expect(providerConfig(DEFAULT_SETTINGS.translate, "")).toBeNull();
    const config = providerConfig({ ...DEFAULT_SETTINGS.translate, provider: "libretranslate", libreUrl: "https://lt.example.org" }, "")!;
    const translator = translatorFor(config, async (request) => {
      const body = JSON.parse(request.body) as { q: string[] };
      return { status: 200, body: JSON.stringify({ translatedText: body.q.map((text) => text.toUpperCase()) }) };
    });
    expect((await translator.translate(["hello"], null, "fr")).texts).toEqual(["HELLO"]);
  });
});
