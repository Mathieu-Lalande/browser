import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import type { BrowserState } from "@shared/types";
import { expect, launch, openPrivateWindow, test as base, visit } from "./fixtures";

// The AI assistant (ADR-044) against a fake Anthropic-compatible server (BROWSER_TEST_ANTHROPIC_URL,
// ignored once packaged): off by default, the privacy notice first, a summary streamed into the
// panel, "Arrêter" stops an answer, and a private window sends nothing before its own confirmation.

type Global = { browser: BrowserApi };
type Logged = { url: string; key?: string; beta?: string; cookie?: string; body: { model: string; stream?: boolean; messages: { role: string; content: string }[]; fallbacks?: unknown } };

interface FakeAnthropic {
  origin: string;
  requests: Logged[];
}

const ARTICLE = `<!doctype html><html lang="fr"><head><title>Licornes</title></head><body><article><h1>Les licornes</h1>
${"<p>La licorne est une créature légendaire à corne unique, souvent décrite comme un cheval blanc. Elle symbolise la pureté dans de nombreux récits du Moyen Âge, et sa corne passait pour guérir les poisons.</p>".repeat(6)}
</article></body></html>`;

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

async function streamAnswer(res: ServerResponse, chunks: string[], delay: number): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  res.write(sse("message_start", { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }));
  res.write(sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
  for (const text of chunks) {
    if (res.destroyed) return;
    res.write(sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }));
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  res.write(sse("content_block_stop", { type: "content_block_stop", index: 0 }));
  res.write(sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: chunks.length } }));
  res.end(sse("message_stop", { type: "message_stop" }));
}

function startFake(): Promise<{ server: Server; fake: FakeAnthropic }> {
  const fake: FakeAnthropic = { origin: "", requests: [] };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = req.url ?? "/";
    if (req.method === "GET" && path.startsWith("/article")) {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("set-cookie", "session=secret; Path=/");
      return res.end(ARTICLE);
    }
    if (req.method === "GET" && path.startsWith("/v1/models/")) {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ id: path.split("/")[3], type: "model", display_name: "Test", created_at: "2026-01-01T00:00:00Z" }));
    }
    if (req.method === "POST" && path.startsWith("/v1/messages")) {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const body = JSON.parse(raw) as Logged["body"];
        fake.requests.push({ url: path, key: (req.headers["x-api-key"] as string) ?? req.headers.authorization?.replace(/^Bearer /, ""), beta: req.headers["anthropic-beta"] as string, cookie: req.headers.cookie, body });
        const last = body.messages[body.messages.length - 1].content;
        if (last.includes("LENT")) void streamAnswer(res, Array.from({ length: 200 }, (_, index) => `mot${index} `), 100);
        else void streamAnswer(res, ["## Résumé\n\n", "La page parle de ", "**licornes** ", "et de leur corne."], 60);
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      fake.origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
      resolve({ server, fake });
    }),
  );
}

const test = base.extend<{ anthropic: FakeAnthropic }>({
  anthropic: async ({}, use) => {
    const { server, fake } = await startFake();
    await use(fake);
    server.closeAllConnections();
    server.close();
  },
  app: async ({ profile, anthropic }, use) => {
    const app = await launch(profile, { BROWSER_TEST_ANTHROPIC_URL: anthropic.origin, BROWSER_TEST_PLAIN_KEYCHAIN: "1" });
    await use(app);
    await app.close();
  },
});

const browserApi = (chrome: Page) => ({
  run: <T>(fn: (api: BrowserApi, arg: string) => T | Promise<T>, arg = "") =>
    chrome.evaluate(([source, value]) => new Function("api", "arg", `return (${source})(api, arg)`)((globalThis as unknown as Global).browser, value), [fn.toString(), arg] as const) as Promise<T>,
});

async function enable(chrome: Page): Promise<void> {
  const api = browserApi(chrome);
  await api.run((browser) => browser.settings.update({ assistant: { enabled: true } }));
  const saved = await api.run((browser) => browser.assistant.setKey("sk-ant-test-key"));
  expect(saved.ok).toBe(true);
  // The key never comes back to a UI: only whether one is set.
  expect(await api.run((browser) => browser.assistant.key())).toEqual({ available: true, message: null, set: true });
}

test("summarizes a page after the privacy notice, streams the answer, and stops one", async ({ chrome, anthropic }) => {
  // Off by default.
  expect(await browserApi(chrome).run((browser) => browser.settings.get().then((s) => s.assistant.enabled))).toBe(false);
  await enable(chrome);
  await visit(chrome, `${anthropic.origin}/article`, "Licornes");
  await browserApi(chrome).run((browser) => browser.commands.run("toggle-assistant"));
  const panel = chrome.getByTestId("assistant-panel");
  await expect(panel).toBeVisible();

  await panel.getByRole("button", { name: "Résumer la page" }).click();
  const notice = panel.getByTestId("assistant-notice");
  await expect(notice).toContainText("envoyés à Anthropic");
  await expect(notice).toContainText("Demande en attente : Résumer la page");
  expect(anthropic.requests).toHaveLength(0);
  await notice.getByRole("button", { name: "Accepter et envoyer" }).click();

  const answer = panel.getByTestId("assistant-answer").last();
  await expect(answer).toContainText("La page parle de licornes et de leur corne.");
  await expect(answer).toHaveAttribute("data-status", "done");
  // Markdown drawn as elements, never as raw text or HTML.
  await expect(answer.locator("strong")).toHaveText("licornes");
  await expect(answer.locator("h3")).toHaveText("Résumé");
  await expect(panel.getByTestId("assistant-question").last()).toContainText("Envoyé à Anthropic : Licornes");
  await expect(notice).toHaveCount(0);

  const [request] = anthropic.requests;
  expect(request.key).toBe("sk-ant-test-key");
  expect(request.cookie).toBeUndefined();
  expect(request.beta).toContain("server-side-fallback-2026-07-01");
  expect(request.body).toMatchObject({ model: "claude-opus-5-5", stream: true, fallbacks: "default" });
  expect(request.body.messages[0].content).toContain("corne unique");
  expect(request.body.messages[0].content).toContain('<page index="1" title="Licornes"');

  // A long answer, stopped while it streams.
  const input = panel.getByLabel("Question à l'assistant");
  await input.fill("Réponds LENT ?");
  await input.press("Enter");
  const slow = panel.getByTestId("assistant-answer").last();
  await expect(slow).toContainText("mot3");
  await panel.getByRole("button", { name: "Arrêter la réponse" }).click();
  await expect(slow).toHaveAttribute("data-status", "stopped");
  await expect(slow).toContainText("Réponse arrêtée.");
  const stoppedAt = (await slow.textContent())!.length;
  await chrome.waitForTimeout(500);
  expect((await slow.textContent())!.length).toBe(stoppedAt);
  // The follow-up carried the earlier exchange and did not send the page again.
  const followUp = anthropic.requests[1].body.messages;
  expect(followUp.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
  expect(followUp[2].content).toBe("Réponds LENT ?");
});

test("a private window sends nothing before its own confirmation", async ({ app, chrome, anthropic }) => {
  await enable(chrome);
  await browserApi(chrome).run((browser) => browser.settings.update({ assistant: { acknowledged: true } }));
  const privateChrome = await openPrivateWindow(app, chrome);
  await visit(privateChrome, `${anthropic.origin}/article?private`, "Licornes");
  const tabId = ((await privateChrome.evaluate(() => (globalThis as unknown as Global).browser.getState())) as BrowserState).activeTabId!;

  const refused = await browserApi(privateChrome).run((browser, id) => browser.assistant.ask(id, { action: "summarize" }), tabId);
  expect(refused).toMatchObject({ ok: false, needsConsent: true });
  await browserApi(privateChrome).run((browser) => browser.commands.run("toggle-assistant"));
  const panel = privateChrome.getByTestId("assistant-panel");
  await expect(panel.getByTestId("assistant-notice")).toContainText("Fenêtre privée");
  expect(anthropic.requests).toHaveLength(0);

  await panel.getByRole("button", { name: "Accepter et envoyer" }).click();
  await expect(panel.getByTestId("assistant-answer").last()).toHaveAttribute("data-status", "done");
  expect(anthropic.requests).toHaveLength(1);
  // Saving a key is refused from a private window.
  await expect(browserApi(privateChrome).run((browser) => browser.assistant.setKey("other"))).rejects.toThrow();
});
