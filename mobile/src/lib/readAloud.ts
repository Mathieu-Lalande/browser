import { speechChunks, type SpeechParagraph, type SpeechVoiceInfo } from "@shared/read-aloud";
import type { ReaderBlock } from "./reader";

/**
 * Read aloud on the phone (ADR-058): the native reader's blocks (`readerBlocks`) as spoken
 * paragraphs, chunked by the shared `speechChunks` (Android refuses long utterances). Keys are
 * block indexes ("title" for the title), so the screen highlights and scrolls to the block read.
 */
export function speechBlocks(title: string, blocks: readonly ReaderBlock[]): SpeechParagraph[] {
  const out: SpeechParagraph[] = [];
  const push = (key: string, text: string) => {
    const chunks = speechChunks(text);
    if (chunks.length) out.push({ key, text, chunks });
  };
  push("title", title);
  blocks.forEach((block, index) => {
    if ("spans" in block) push(String(index), block.spans.map((span) => span.text).join(""));
  });
  return out;
}

/** `expo-speech` voices in the shared shape. The system engine runs them on the device. */
export function deviceVoices(voices: readonly { identifier: string; name: string; language: string }[]): SpeechVoiceInfo[] {
  return voices.map((voice) => ({ id: voice.identifier, name: voice.name, lang: voice.language, local: true }));
}
