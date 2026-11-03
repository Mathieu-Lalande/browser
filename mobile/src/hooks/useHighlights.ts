import { addHighlight, annotationUrl, COLOR_LABELS, HIGHLIGHT_COLORS, removeHighlight, updateHighlight, type AnnotationsData, type HighlightColor, type TextQuote } from "@shared/annotations/model";
import { useRef } from "react";
import type { MenuItem, MenuSpec } from "../components/ActionSheet";
import { isPrivateTab, type TabsModel } from "../lib/tabs";
import { newId, type BrowserActions } from "../state/BrowserProvider";
import type { Theme } from "../state/theme";
import { useEvent } from "./useEvent";

/**
 * Highlights (ADR-037): "Surligner" in the page's selection menu adds one (normal tabs only, in
 * the last color used); a tap on one opens its sheet (color, copy, delete) unless `busy`.
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
}: {
  model: TabsModel;
  annotations: AnnotationsData;
  activeId: string | undefined;
  busy: boolean;
  actions: BrowserActions;
  haptic: Theme["haptic"];
  setMenu: (menu: MenuSpec) => void;
  copy: (text: string) => void;
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
        { key: "copy", label: "Copier le passage", icon: "copy", onPress: () => copy(highlight.exact) },
        { key: "delete", label: "Supprimer le surlignage", icon: "trash", destructive: true, onPress: () => actions.setAnnotations((data) => removeHighlight(data, id)) },
      ],
    });
  });

  return { onHighlight, onHighlightPress };
}
