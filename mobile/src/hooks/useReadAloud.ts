import { getLocale } from "@shared/i18n";
import { clampSpeechRate, nextChunk, pickVoice, speechLanguage, START, stepParagraph, voicesFor, type SpeechParagraph, type SpeechPosition, type SpeechVoiceInfo } from "@shared/read-aloud";
import * as Speech from "expo-speech";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deviceVoices } from "../lib/readAloud";

export type ReadAloudStatus = "idle" | "playing" | "paused";

interface Options {
  paragraphs: readonly SpeechParagraph[];
  articleLang: string | null | undefined;
  rate: number;
  voiceId: string;
}

/**
 * Read aloud in the native reader (ADR-058) with `expo-speech` (the system's own engine, on the
 * device). One chunk per utterance; pause is stop + restart of the chunk (`Speech.pause` is iOS
 * only). Stops when the reader closes (unmount).
 */
export function useReadAloud({ paragraphs, articleLang, rate, voiceId }: Options) {
  const [status, setStatus] = useState<ReadAloudStatus>("idle");
  const [position, setPosition] = useState<SpeechPosition>(START);
  const [allVoices, setAllVoices] = useState<SpeechVoiceInfo[]>([]);
  const generation = useRef(0);
  const live = useRef({ status, position, paragraphs });
  live.current = { status, position, paragraphs };

  useEffect(() => {
    let active = true;
    Speech.getAvailableVoicesAsync()
      .then((voices) => active && setAllVoices(deviceVoices(voices)))
      .catch(() => {});
    return () => {
      active = false;
      generation.current++;
      void Speech.stop();
    };
  }, []);

  const lang = speechLanguage(articleLang, getLocale());
  const voices = useMemo(() => voicesFor(allVoices, lang, getLocale()), [allVoices, lang]);
  const voice = pickVoice(voices, voiceId);
  const settingsRef = useRef({ rate, voice, lang });
  settingsRef.current = { rate: clampSpeechRate(rate), voice, lang };

  const speakAt = useCallback((at: SpeechPosition) => {
    const current = ++generation.current;
    void Speech.stop();
    const text = live.current.paragraphs[at.paragraph]?.chunks[at.chunk];
    if (text === undefined) {
      setStatus("idle");
      return;
    }
    setPosition(at);
    const { rate: speed, voice: chosen, lang: language } = settingsRef.current;
    const advance = () => {
      if (current !== generation.current) return;
      const next = nextChunk(live.current.paragraphs, at);
      if (next) speakAt(next);
      else {
        setStatus("idle");
        setPosition(START);
      }
    };
    Speech.speak(text, { language: chosen?.lang ?? language, voice: chosen?.id, rate: speed, onDone: advance, onError: advance });
  }, []);

  const play = useCallback(() => {
    setStatus("playing");
    speakAt(live.current.status === "idle" ? START : live.current.position);
  }, [speakAt]);

  const pause = useCallback(() => {
    generation.current++;
    void Speech.stop();
    setStatus("paused");
  }, []);

  const stop = useCallback(() => {
    generation.current++;
    void Speech.stop();
    setStatus("idle");
    setPosition(START);
  }, []);

  const step = useCallback(
    (delta: -1 | 1) => {
      const next = stepParagraph(live.current.paragraphs, live.current.position, delta);
      if (!next) return stop();
      if (live.current.status === "playing") speakAt(next);
      else setPosition(next);
    },
    [speakAt, stop],
  );

  // A new speed or voice applies from the current chunk.
  useEffect(() => {
    if (live.current.status === "playing") speakAt(live.current.position);
  }, [rate, voice?.id, speakAt]);

  const activeKey = status === "idle" ? null : (paragraphs[position.paragraph]?.key ?? null);
  return { status, activeKey, voices, voice, play, pause, stop, step };
}
