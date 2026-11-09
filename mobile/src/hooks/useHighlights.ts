import {
  addHighlight,
  ANNOTATION_LIMITS,
  annotationUrl,
  COLOR_LABELS,
  HIGHLIGHT_COLORS,
  noteFor,
  removeHighlight,
  setPageNote,
  updateHighlight,
  type AnnotationsData,
  type HighlightColor,
  type TextQuote,
} from "@shared/annotations/model";
import { useRef } from "react";
import type { MenuItem, MenuSpec } from "../components/ActionSheet";
import type { NoteTarget } from "../components/NoteSheet";
import { isPrivateTab, type MobileTab, type TabsModel } from "../lib/tabs";
import { newId, type BrowserActions } from "../state/BrowserProvider";
import type { Theme } from "../state/theme";
import { useEvent } from "./useEvent";

/**
 * Highlights (ADR-037): "Surligner" in the page's selection menu adds one (normal tabs only, in
 * the last color used); a tap on one opens its sheet (color, note, copy, delete) unless `busy`.
 * Notes on a highlight and the page's note are written in the note sheet (`setNote`, ADR-050).
 */
export function useHighlights({
  model,
  annotations,
  activeId,
  busy,
  actions,
  haptic,
  setMenu,
  copy,
  setNote,
}: {
  model: TabsModel;
  annotations: AnnotationsData;
  activeId: string | undefined;
  busy: boolean;
  actions: BrowserActions;
  haptic: Theme["haptic"];
  setMenu: (menu: MenuSpec) => void;
  copy: (text: string) => void;
  setNote: (target: NoteTarget) => void;
}) {
  const lastColor = useRef<HighlightColor>("yellow");

  const onHighlight = useEvent((tabId: string, url: string, quote: TextQuote) => {
    const target = model.tabs.find((candidate) => candidate.id === tabId);
    const key = annotationUrl(url);
    if (!target || isPrivateTab(target) || !key) return;
    haptic("light");
    const now = Date.now();
    actions.setAnnotations((data) => addHighlight(data, { id: `hl-${newId()}`, url: key, title: target.title, quote, color: lastColor.current, now }) ?? data);
  });

  const onHighlightPress = useEvent((tabId: string, id: string) => {
    const highlight = annotations.highlights.find((item) => item.id === id);
    if (!highlight || tabId !== activeId || busy) return;
    const setColor = (color: HighlightColor) => {
      lastColor.current = color;
      actions.setAnnotations((data) => updateHighlight(data, id, { color }, Date.now()));
    };
    setMenu({
      title: highlight.exact.length > 120 ? `${highlight.exact.slice(0, 119)}…` : highlight.exact,
      subtitle: highlight.note || undefined,
      items: [
        ...HIGHLIGHT_COLORS.filter((color) => color !== highlight.color).map(
          (color): MenuItem => ({ key: color, label: `Surligner en ${COLOR_LABELS[color].toLowerCase()}`, icon: "highlighter", onPress: () => setColor(color) }),
        ),
        {
          key: "note",
          label: highlight.note ? "Modifier la note" : "Ajouter une note",
          icon: "edit",
          onPress: () => setNote({ kind: "highlight", id, context: highlight.exact, initial: highlight.note, maxLength: ANNOTATION_LIMITS.note }),
        },
        { key: "copy", label: "Copier le passage", icon: "copy", onPress: () => copy(highlight.exact) },
        { key: "delete", label: "Supprimer le surlignage", icon: "trash", destructive: true, onPress: () => actions.setAnnotations((data) => removeHighlight(data, id)) },
      ],
    });
  });

  /** "Note de la page" of the page menu: normal tabs on a web page only. */
  const pageNote = (tab: MobileTab | null): (() => void) | null => {
    const key = tab && !isPrivateTab(tab) ? annotationUrl(tab.url) : null;
    if (!tab || !key) return null;
    return () => setNote({ kind: "page", id: tab.url, context: tab.title, initial: noteFor(annotations, key)?.text ?? "", maxLength: ANNOTATION_LIMITS.pageNote });
  };

  /** Saves what the note sheet returns (an empty text removes the note). */
  const saveNote = useEvent((target: NoteTarget, text: string) => {
    const now = Date.now();
    if (target.kind === "highlight") actions.setAnnotations((data) => updateHighlight(data, target.id, { note: text }, now));
    else actions.setAnnotations((data) => setPageNote(data, target.id, target.context, text, now));
  });

  return { onHighlight, onHighlightPress, pageNote, saveNote };
}
