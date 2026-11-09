import { t as tr } from "@shared/i18n";
import { providerLabel, TranslationError } from "@shared/translate/providers";
import { targetLanguage } from "@shared/translate/languages";
import type { Segment } from "@shared/translate/segments";
import type { Translator } from "@shared/translate/translator";
import { useRef, useState } from "react";
import { Alert } from "react-native";
import { providerConfig, translatorFor } from "../lib/translate";
import { useBrowserActions, useBrowserState, useEvent } from "./BrowserProvider";
import { translateKeys } from "./translate";

/** The phone's language (Hermes has Intl): the default target. */
const phoneLanguages = (): string[] => {
  try {
    return [Intl.DateTimeFormat().resolvedOptions().locale];
  } catch {
    return [];
  }
};

type Request = { seq: number; action: "translate" | "restore" };

/**
 * Page translation on the phone (ADR-036): which tabs are translated, the requests sent to their
 * WebViews, and the provider calls for the batches they post. Nothing is sent before the privacy
 * notice was accepted (once; for private tabs, once per run of the app, never saved).
 */
export function usePageTranslation(openSettings: () => void) {
  const { settings } = useBrowserState();
  const actions = useBrowserActions();
  const [requests, setRequests] = useState<Readonly<Record<string, Request>>>({});
  const [translated, setTranslated] = useState<ReadonlySet<string>>(() => new Set());
  const privateConsent = useRef(false);
  const translator = useRef<{ signature: string; value: Translator } | null>(null);
  /** One error alert per tab and request (several batches may fail at once). */
  const failed = useRef(new Set<string>());

  const send = (tabId: string, action: Request["action"]) => {
    setRequests((current) => ({ ...current, [tabId]: { seq: (current[tabId]?.seq ?? 0) + 1, action } }));
    setTranslated((current) => {
      const next = new Set(current);
      if (action === "translate") next.add(tabId);
      else next.delete(tabId);
      return next;
    });
  };

  const translatorNow = async (): Promise<Translator> => {
    const t = settings.translate;
    const config = providerConfig(t, t.provider === "none" ? "" : await translateKeys.get(t.provider));
    if (!config) throw new TranslationError("config", tr("mobile.usePageTranslation.chooseTranslationServiceSettings"));
    const signature = JSON.stringify(config);
    if (translator.current?.signature !== signature) translator.current = { signature, value: translatorFor(config) };
    return translator.current.value;
  };

  /** "Traduire la page" / "Afficher l'original" from the page menu. */
  const toggle = useEvent(async (tabId: string, isPrivate: boolean) => {
    if (translated.has(tabId)) return send(tabId, "restore");
    const t = settings.translate;
    try {
      await translatorNow();
    } catch (error) {
      Alert.alert("Traduction indisponible", error instanceof Error ? error.message : "", [
        { text: tr("mobile.usePageTranslation.cancel"), style: "cancel" },
        { text: tr("mobile.usePageTranslation.settings"), onPress: openSettings },
      ]);
      return;
    }
    const needsConsent = isPrivate ? !privateConsent.current : !t.acknowledged;
    if (!needsConsent || t.provider === "none") return send(tabId, "translate");
    Alert.alert(
      tr("mobile.usePageTranslation.translatePage"),
      `Le texte de cette page sera envoyé à ${providerLabel(t.provider)} pour être traduit.${isPrivate ? " Onglet privé : confirmation demandée à chaque session, rien n'est enregistré." : ""}`,
      [
        { text: tr("mobile.usePageTranslation.cancel"), style: "cancel" },
        {
          text: tr("mobile.usePageTranslation.translate"),
          onPress: () => {
            if (isPrivate) privateConsent.current = true;
            else actions.updateSettings({ translate: { acknowledged: true } });
            failed.current.delete(tabId);
            send(tabId, "translate");
          },
        },
      ],
    );
  });

  /** A batch from a translated tab's page: the provider detects the source language. */
  const batch = useEvent(async (tabId: string, segments: Segment[]): Promise<[number, string][]> => {
    if (!translated.has(tabId)) return [];
    try {
      const to = targetLanguage(settings.translate.target, phoneLanguages());
      const result = await (await translatorNow()).translate(
        segments.map((segment) => segment.text),
        null,
        to,
      );
      return segments.flatMap((segment, index): [number, string][] => (result.texts[index] ? [[segment.id, result.texts[index]!]] : []));
    } catch (error) {
      if (!failed.current.has(tabId)) {
        failed.current.add(tabId);
        Alert.alert("Traduction interrompue", error instanceof Error ? error.message : tr("mobile.usePageTranslation.translationFailed"));
      }
      throw error;
    }
  });

  /** The tab loaded another document: nothing is translated any more. */
  const reset = useEvent((tabId: string) => {
    failed.current.delete(tabId);
    setTranslated((current) => {
      if (!current.has(tabId)) return current;
      const next = new Set(current);
      next.delete(tabId);
      return next;
    });
  });

  return { requests, translated, toggle, batch, reset };
}
