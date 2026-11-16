import { clampSpeechRate, nextChunk, pickVoice, speechLanguage, speechParagraphs, START, stepParagraph, voicesFor, type SpeechParagraph, type SpeechPosition, type SpeechVoiceInfo } from "@shared/read-aloud";
import type { ReaderArticle } from "@shared/reader";
import type { TabId } from "@shared/types";
import { api, browser } from "./browser.svelte";
import { locale } from "./i18n.svelte";
import { settings } from "./settings.svelte";

/**
 * Read aloud and presentation mode of the reader (ADR-058), chrome UI side. Speech is the Web
 * Speech API of this renderer (the system's own voices, local ones only: nothing leaves the
 * device), one short chunk per utterance (`@shared/read-aloud`). The controller lives at module
 * level, not in `ReaderView`: reading goes on when another tab is shown (a mini control appears
 * in the sidebar) and stops when the tab leaves the reader or closes.
 */

export type ReadAloudStatus = "idle" | "playing" | "paused";

interface SpeakOptions {
  lang: string;
  voice: string | null;
  rate: number;
}

/** What the controller needs from a speech engine (the Web Speech API, or a test's fake). */
interface SpeechEngine {
  voices(): SpeechVoiceInfo[];
  speak(text: string, options: SpeakOptions, done: (failed: boolean) => void): void;
  cancel(): void;
  onVoicesChanged(listener: () => void): void;
}

/**
 * The Web Speech API, looked up at each call (e2e tests swap `speechSynthesis` for a fake: CI has
 * no voice). Pause is cancel + restart of the current chunk: `pause()` is unreliable on Linux.
 */
const webSpeech: SpeechEngine = {
  voices: () =>
    (globalThis.speechSynthesis?.getVoices() ?? []).map((voice) => ({
      id: voice.voiceURI,
      name: voice.name,
      lang: voice.lang,
      local: voice.localService !== false,
      default: voice.default,
    })),
  speak(text, options, done) {
    const synth = globalThis.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return done(true);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = options.lang;
    utterance.rate = options.rate;
    const voice = options.voice ? synth.getVoices().find((entry) => entry.voiceURI === options.voice) : undefined;
    if (voice) utterance.voice = voice;
    utterance.onend = () => done(false);
    utterance.onerror = (event) => done(event.error !== "interrupted" && event.error !== "canceled");
    synth.speak(utterance);
  },
  cancel: () => globalThis.speechSynthesis?.cancel(),
  onVoicesChanged(listener) {
    globalThis.speechSynthesis?.addEventListener?.("voiceschanged", listener);
  },
};

class ReadAloud {
  status = $state<ReadAloudStatus>("idle");
  tabId = $state<TabId | null>(null);
  title = $state("");
  paragraphs = $state.raw<SpeechParagraph[]>([]);
  position = $state<SpeechPosition>(START);
  /** The system has no local voice for any language: the button explains it instead of reading. */
  noVoice = $state(false);
  private lang = $state("");
  private allVoices = $state.raw<SpeechVoiceInfo[]>([]);
  /** Bumped on each utterance: events of a cancelled one are ignored. */
  private generation = 0;
  /** A failed chunk in a row: the next ones are skipped, two in a row stop (no voice, engine gone). */
  private failures = 0;
  private voicesWatched = false;

  constructor(private readonly engine: SpeechEngine) {}

  /** Voices offered for the article being read (its language, else the UI's). */
  readonly voices = $derived(voicesFor(this.allVoices, this.lang, locale.current));
  readonly rate = $derived(clampSpeechRate(settings.current.reader?.speechRate));
  readonly voice = $derived(pickVoice(this.voices, settings.current.reader?.voice ?? ""));
  /** Key of the paragraph being read (`ReaderNodes`' `data-speech`). */
  readonly activeKey = $derived(this.status === "idle" ? null : (this.paragraphs[this.position.paragraph]?.key ?? null));

  refreshVoices(): void {
    this.allVoices = this.engine.voices();
    if (!this.voicesWatched) {
      this.voicesWatched = true;
      this.engine.onVoicesChanged(() => (this.allVoices = this.engine.voices()));
    }
  }

  /** Prepares the article's language and voices (the toolbar shows the picker before playing). */
  prepare(article: ReaderArticle): void {
    if (this.status === "idle") this.lang = speechLanguage(article.lang, locale.current);
    this.refreshVoices();
  }

  /** Starts reading `article` of `tabId` from the beginning (or from `paragraph`). */
  start(tabId: TabId, article: ReaderArticle, paragraph = 0, retried = false): void {
    this.refreshVoices();
    const paragraphs = speechParagraphs(article);
    if (!paragraphs.length) return;
    // Chromium lists the voices asynchronously the first time: one more look before giving up.
    if (!this.allVoices.length && !retried) {
      setTimeout(() => this.start(tabId, article, paragraph, true), 800);
      return;
    }
    this.noVoice = this.allVoices.every((voice) => !voice.local);
    if (this.noVoice) return;
    this.tabId = tabId;
    this.title = article.title;
    this.lang = speechLanguage(article.lang, locale.current);
    this.paragraphs = paragraphs;
    this.position = { paragraph: Math.min(paragraph, paragraphs.length - 1), chunk: 0 };
    this.failures = 0;
    this.play();
  }

  play(): void {
    if (!this.paragraphs.length) return;
    this.status = "playing";
    this.speakCurrent();
  }

  pause(): void {
    if (this.status !== "playing") return;
    this.generation++;
    this.engine.cancel();
    this.status = "paused";
  }

  toggle(): void {
    if (this.status === "playing") this.pause();
    else this.play();
  }

  stop(): void {
    this.generation++;
    if (this.status !== "idle") this.engine.cancel();
    this.status = "idle";
    this.tabId = null;
    this.paragraphs = [];
    this.position = START;
  }

  /** Previous/next paragraph; past the end stops. */
  step(delta: -1 | 1): void {
    const next = stepParagraph(this.paragraphs, this.position, delta);
    if (!next) return this.stop();
    this.position = next;
    if (this.status === "playing") this.speakCurrent();
  }

  setRate(rate: number): void {
    void settings.update({ reader: { speechRate: clampSpeechRate(rate) } });
    this.restartSoon();
  }

  setVoice(id: string): void {
    void settings.update({ reader: { voice: id } });
    this.restartSoon();
  }

  /** The current chunk again with the new rate or voice (once the setting is applied). */
  private restartSoon(): void {
    if (this.status !== "playing") return;
    queueMicrotask(() => this.status === "playing" && this.speakCurrent());
  }

  private speakCurrent(): void {
    const generation = ++this.generation;
    this.engine.cancel();
    const text = this.paragraphs[this.position.paragraph]?.chunks[this.position.chunk];
    if (text === undefined) return this.stop();
    const options = { lang: this.voice?.lang ?? this.lang, voice: this.voice?.id ?? null, rate: this.rate };
    this.engine.speak(text, options, (failed) => {
      if (generation !== this.generation || this.status !== "playing") return;
      this.failures = failed ? this.failures + 1 : 0;
      if (this.failures >= 2) return this.stop();
      const next = nextChunk(this.paragraphs, this.position);
      if (!next) return this.stop();
      this.position = next;
      this.speakCurrent();
    });
  }
}

export const readAloud = new ReadAloud(webSpeech);

/** Presentation mode (ADR-058): the reader alone, full screen. */
class Presentation {
  active = $state(false);
}
export const presentation = new Presentation();

/** A reader command from main (menu, palette, shortcut) for the reader on screen. */
class ReaderRequests {
  pending = $state<"read-aloud" | "presentation" | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  set(request: "read-aloud" | "presentation"): void {
    this.pending = request;
    clearTimeout(this.timer);
    // Dropped if no reader takes it soon (the reader could not open).
    this.timer = setTimeout(() => (this.pending = null), 3000);
  }

  take(): "read-aloud" | "presentation" | null {
    const request = this.pending;
    this.pending = null;
    return request;
  }
}
export const readerRequests = new ReaderRequests();

/** Whether scrolling should jump instead of gliding (app setting, energy saver or the system's). */
export function reducedMotion(): boolean {
  return document.documentElement.hasAttribute("data-reduce-motion") || matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Main's reader commands, and the end of reading when its tab leaves the reader or closes.
api.onUiCommand((command) => {
  if (command === "reader-read-aloud") readerRequests.set("read-aloud");
  if (command === "reader-presentation") readerRequests.set("presentation");
});
$effect.root(() => {
  $effect(() => {
    const id = readAloud.tabId;
    if (!id) return;
    const tab = browser.state.tabs.find((entry) => entry.id === id);
    if (!tab?.reader) readAloud.stop();
  });
});
addEventListener("beforeunload", () => readAloud.stop());
