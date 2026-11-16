import { describe, expect, it } from "vitest";
import {
  SPEECH_CHUNK_MAX,
  clampSpeechRate,
  nextChunk,
  pickVoice,
  speechChunks,
  speechLanguage,
  speechParagraphs,
  speechRateLabel,
  stepParagraph,
  voicesFor,
  type SpeechVoiceInfo,
} from "./read-aloud";
import { pageStep, presentationKeyAction, sectionTarget } from "./reader-presentation";
import type { ReaderNode } from "./reader";

const el = (tag: string, children: ReaderNode[] = []): ReaderNode => ({ tag, children }) as ReaderNode;

describe("speechChunks", () => {
  it("splits sentences, keeping numbers and domains whole", () => {
    expect(speechChunks("Bonjour le monde. Pi vaut 3.14 environ ! Voir example.com? Fin")).toEqual([
      "Bonjour le monde.",
      "Pi vaut 3.14 environ !",
      "Voir example.com?",
      "Fin",
    ]);
  });

  it("keeps closing quotes with their sentence and collapses whitespace", () => {
    expect(speechChunks("  « Oui. »  Il   part.\n")).toEqual(["« Oui. »", "Il part."]);
    expect(speechChunks("He said \"go.\" Then left.")).toEqual(['He said "go."', "Then left."]);
    expect(speechChunks("   ")).toEqual([]);
  });

  it("never exceeds the limit: commas first, then spaces, then anywhere", () => {
    const long = `${"mot ".repeat(40)}, ${"suite ".repeat(60)}`;
    const chunks = speechChunks(long, 100);
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(100);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(long.replace(/\s+/g, " ").trim());
    const word = "x".repeat(250);
    expect(speechChunks(word, 100)).toEqual(["x".repeat(100), "x".repeat(100), "x".repeat(50)]);
    for (const chunk of speechChunks("a ".repeat(2000))) expect(chunk.length).toBeLessThanOrEqual(SPEECH_CHUNK_MAX);
  });
});

describe("speechParagraphs", () => {
  it("reads the title, then each text block in order, with its path", () => {
    const content = [
      el("p", ["Premier ", el("strong", ["paragraphe"]), "."]),
      el("div", [el("h2", ["Titre deux"]), el("ul", [el("li", ["Un"]), el("li", ["Deux", el("ul", [el("li", ["Deux bis"])])])])]),
      el("pre", ["const x = 1;"]),
      el("figure", [el("img"), el("figcaption", ["Légende"])]),
      el("p", ["  "]),
      "Texte libre",
    ];
    const paragraphs = speechParagraphs({ title: "Le titre", content });
    expect(paragraphs.map((p) => [p.key, p.text])).toEqual([
      ["title", "Le titre"],
      ["0", "Premier paragraphe."],
      ["1.0", "Titre deux"],
      ["1.1.0", "Un"],
      ["1.1.1", "Deux"],
      ["1.1.1.1.0", "Deux bis"],
      ["3.1", "Légende"],
      ["content", "Texte libre"],
    ]);
  });

  it("gives every paragraph at least one chunk", () => {
    const paragraphs = speechParagraphs({ title: "", content: [el("p", ["Une. Deux."])] });
    expect(paragraphs).toEqual([{ key: "0", text: "Une. Deux.", chunks: ["Une.", "Deux."] }]);
  });
});

describe("navigation", () => {
  const paragraphs = speechParagraphs({ title: "T", content: [el("p", ["A. B."]), el("p", ["C."])] });

  it("moves chunk by chunk then paragraph by paragraph", () => {
    expect(nextChunk(paragraphs, { paragraph: 0, chunk: 0 })).toEqual({ paragraph: 1, chunk: 0 });
    expect(nextChunk(paragraphs, { paragraph: 1, chunk: 0 })).toEqual({ paragraph: 1, chunk: 1 });
    expect(nextChunk(paragraphs, { paragraph: 1, chunk: 1 })).toEqual({ paragraph: 2, chunk: 0 });
    expect(nextChunk(paragraphs, { paragraph: 2, chunk: 0 })).toBeNull();
    expect(nextChunk([], { paragraph: 0, chunk: 0 })).toBeNull();
  });

  it("previous restarts the paragraph first, next stops at the end", () => {
    expect(stepParagraph(paragraphs, { paragraph: 1, chunk: 1 }, -1)).toEqual({ paragraph: 1, chunk: 0 });
    expect(stepParagraph(paragraphs, { paragraph: 1, chunk: 0 }, -1)).toEqual({ paragraph: 0, chunk: 0 });
    expect(stepParagraph(paragraphs, { paragraph: 0, chunk: 0 }, -1)).toEqual({ paragraph: 0, chunk: 0 });
    expect(stepParagraph(paragraphs, { paragraph: 1, chunk: 1 }, 1)).toEqual({ paragraph: 2, chunk: 0 });
    expect(stepParagraph(paragraphs, { paragraph: 2, chunk: 0 }, 1)).toBeNull();
  });
});

describe("rate and voices", () => {
  it("snaps and bounds the rate", () => {
    expect(clampSpeechRate(1.3)).toBe(1.25);
    expect(clampSpeechRate(0.1)).toBe(0.75);
    expect(clampSpeechRate(9)).toBe(2);
    expect(clampSpeechRate("x")).toBe(1);
    expect(clampSpeechRate(Number.NaN)).toBe(1);
    expect(speechRateLabel(1.25, "fr")).toBe("1,25×");
    expect(speechRateLabel(2, "en")).toBe("2×");
  });

  const voices: SpeechVoiceInfo[] = [
    { id: "fr-b", name: "Bernard", lang: "fr-FR", local: true },
    { id: "fr-a", name: "Amélie", lang: "fr_CA", local: true },
    { id: "fr-net", name: "Cloud", lang: "fr-FR", local: false },
    { id: "en", name: "Daniel", lang: "en-GB", local: true, default: true },
  ];

  it("offers local voices of the article language, else of the UI language", () => {
    expect(voicesFor(voices, "fr", "en").map((v) => v.id)).toEqual(["fr-a", "fr-b"]);
    expect(voicesFor(voices, "de-DE", "en").map((v) => v.id)).toEqual(["en"]);
    expect(voicesFor(voices, null, "fr").map((v) => v.id)).toEqual(["fr-a", "fr-b"]);
    expect(voicesFor(voices, "ja", "de")).toEqual([]);
  });

  it("keeps the chosen voice when it fits, else the first", () => {
    const offered = voicesFor(voices, "fr", "en");
    expect(pickVoice(offered, "fr-b")?.id).toBe("fr-b");
    expect(pickVoice(offered, "en")?.id).toBe("fr-a");
    expect(pickVoice([], "en")).toBeNull();
    expect(speechLanguage("en-US", "fr")).toBe("en-US");
    expect(speechLanguage("<script>", "fr")).toBe("fr");
    expect(speechLanguage(null, "en")).toBe("en");
  });
});

describe("presentation mode", () => {
  it("maps keys", () => {
    expect(presentationKeyAction("ArrowRight", false)).toBe("next-section");
    expect(presentationKeyAction("ArrowLeft", false)).toBe("previous-section");
    expect(presentationKeyAction(" ", false)).toBe("next-page");
    expect(presentationKeyAction(" ", true)).toBe("previous-page");
    expect(presentationKeyAction("PageUp", false)).toBe("previous-page");
    expect(presentationKeyAction("Escape", false)).toBe("exit");
    expect(presentationKeyAction("+", false)).toBe("larger");
    expect(presentationKeyAction("Tab", false)).toBeNull();
  });

  it("finds the next and previous sections", () => {
    const tops = [0, 400, 900];
    expect(sectionTarget(tops, 0, 1)).toBe(400);
    expect(sectionTarget(tops, 402, 1)).toBe(900);
    expect(sectionTarget(tops, 950, 1)).toBeNull();
    expect(sectionTarget(tops, 950, -1)).toBe(900);
    expect(sectionTarget(tops, 900, -1)).toBe(400);
    expect(sectionTarget([300], 100, -1)).toBe(0);
    expect(sectionTarget([300], 0, -1)).toBeNull();
    expect(pageStep(1000)).toBe(880);
  });
});
