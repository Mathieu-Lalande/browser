import type { Page } from "@playwright/test";
import type { BrowserApi } from "@shared/ipc";
import type { BrowserState } from "@shared/types";
import { expect, test, visit } from "./fixtures";

// Read aloud and presentation mode of the reader (ADR-058). CI has no system voice: the chrome UI's
// Web Speech API is swapped for a fake engine that "speaks" each utterance in 120 ms and records it.

type Spoken = { text: string; rate: number; voice: string | null };
type Global = { browser: BrowserApi; __spoken: Spoken[] };
const api = (chrome: Page) => chrome.evaluate.bind(chrome);
const state = (chrome: Page) => chrome.evaluate(() => (globalThis as unknown as Global).browser.getState()) as Promise<BrowserState>;
const spoken = (chrome: Page) => chrome.evaluate(() => (globalThis as unknown as Global).__spoken);

async function fakeSpeech(chrome: Page): Promise<void> {
  await chrome.evaluate(() => {
    const g = globalThis as unknown as Global & Record<string, unknown>;
    g.__spoken = [];
    const voices = [
      { voiceURI: "fr-amelie", name: "Amélie", lang: "fr-FR", localService: true, default: true },
      { voiceURI: "fr-thomas", name: "Thomas", lang: "fr-FR", localService: true, default: false },
      { voiceURI: "fr-cloud", name: "Nuage", lang: "fr-FR", localService: false, default: false },
      { voiceURI: "en-daniel", name: "Daniel", lang: "en-GB", localService: true, default: false },
    ];
    let current: { onend?: () => void } | null = null;
    class Utterance {
      lang = "";
      rate = 1;
      voice: { voiceURI: string } | null = null;
      onend?: () => void;
      onerror?: () => void;
      constructor(readonly text: string) {}
    }
    g.SpeechSynthesisUtterance = Utterance;
    Object.defineProperty(globalThis, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => voices,
        addEventListener: () => {},
        cancel: () => (current = null),
        speak(utterance: Utterance) {
          current = utterance;
          g.__spoken.push({ text: utterance.text, rate: utterance.rate, voice: utterance.voice?.voiceURI ?? null });
          setTimeout(() => current === utterance && utterance.onend?.(), 120);
        },
      },
    });
  });
}

test("reads the article aloud paragraph by paragraph, on in another tab, stopped when the reader closes", async ({ chrome, server }) => {
  await fakeSpeech(chrome);
  const url = server.url("/article");
  await visit(chrome, url, "Un article de test");
  await expect.poll(async () => (await state(chrome)).tabs.find((tab) => tab.url === url)?.readerable).toBe(true);

  // The command opens the reader and starts reading (menu, palette, Ctrl+Maj+U).
  await api(chrome)(() => (globalThis as unknown as Global).browser.commands.run("read-aloud"));
  const reader = chrome.getByTestId("reader-view");
  await expect(reader).toBeVisible();
  const controls = reader.getByTestId("read-aloud");
  await expect(controls.getByRole("button", { name: "Mettre en pause" })).toBeVisible();
  await expect.poll(async () => (await spoken(chrome))[0]?.text).toBe("Un article de test");
  // Sentence by sentence, never one long utterance; only local voices of the article's language.
  await expect.poll(async () => (await spoken(chrome)).length).toBeGreaterThan(3);
  for (const entry of await spoken(chrome)) expect(entry.text.length).toBeLessThanOrEqual(220);
  expect((await spoken(chrome))[0]?.voice).toBe("fr-amelie");
  const voice = controls.getByRole("combobox", { name: "Voix" });
  await expect(voice.locator("option")).toHaveText(["Amélie", "Thomas"]);
  // The paragraph read is highlighted.
  await expect(reader.locator("[data-speaking]")).toHaveCount(1);

  // Speed and voice apply to the next utterance.
  await controls.getByRole("combobox", { name: "Vitesse de lecture" }).selectOption("1.5");
  await voice.selectOption("fr-thomas");
  await expect.poll(async () => (await spoken(chrome)).at(-1)).toMatchObject({ rate: 1.5, voice: "fr-thomas" });

  // Next paragraph skips ahead.
  const before = (await spoken(chrome)).length;
  await controls.getByRole("button", { name: "Paragraphe suivant" }).click();
  await expect.poll(async () => (await spoken(chrome)).length).toBeGreaterThan(before);

  // Another tab: reading goes on, with the mini control in the sidebar.
  await api(chrome)(() => (globalThis as unknown as Global).browser.tabs.create("about:blank"));
  const mini = chrome.getByTestId("read-aloud-mini");
  await expect(mini).toBeVisible();
  const count = (await spoken(chrome)).length;
  await expect.poll(async () => (await spoken(chrome)).length).toBeGreaterThan(count);
  await mini.getByRole("button", { name: "Mettre en pause" }).click();
  await expect(mini.getByRole("button", { name: "Reprendre la lecture" })).toBeVisible();
  // Back to the article tab: the toolbar takes over.
  await mini.getByTitle("Afficher l'onglet lu").click();
  await expect(mini).toBeHidden();
  await expect(controls.getByRole("button", { name: "Reprendre la lecture" })).toBeVisible();
  await controls.getByRole("button", { name: "Reprendre la lecture" }).click();

  // Leaving the reader stops reading.
  await reader.getByRole("button", { name: /Quitter/ }).click();
  await expect(reader).toBeHidden();
  const stopped = (await spoken(chrome)).length;
  await chrome.waitForTimeout(400);
  expect((await spoken(chrome)).length).toBe(stopped);
  await expect(mini).toBeHidden();
});

test("presentation mode: full screen, the article alone, keyboard, Esc to leave", async ({ app, chrome, server }) => {
  const url = server.url("/article");
  await visit(chrome, url, "Un article de test");
  await expect.poll(async () => (await state(chrome)).tabs.find((tab) => tab.url === url)?.readerable).toBe(true);
  await api(chrome)(() => (globalThis as unknown as Global).browser.commands.run("reader-presentation"));

  const reader = chrome.getByTestId("reader-view");
  await expect(chrome.getByTestId("presentation-bar")).toBeAttached();
  await expect(reader).toHaveClass(/presenting/);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.isFullScreen()))).toBe(true);
  // Large type, adjustable.
  expect(await reader.locator("article").evaluate((element) => parseFloat(element.ownerDocument.defaultView!.getComputedStyle(element).fontSize))).toBe(30);
  await chrome.keyboard.press("+");
  await expect.poll(() => reader.locator("article").evaluate((element) => parseFloat(element.ownerDocument.defaultView!.getComputedStyle(element).fontSize))).toBe(32);
  // Space turns a page.
  const scroll = reader.locator(".scroll");
  await chrome.keyboard.press("Space");
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await chrome.keyboard.press("Escape");
  await expect(reader).not.toHaveClass(/presenting/);
  await expect(chrome.getByTestId("presentation-bar")).toHaveCount(0);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.isFullScreen()))).toBe(false);
  await expect(reader.getByTestId("presentation-enter")).toBeVisible();
});
