import { useCallback, useEffect, useRef, useState } from "react";
import { Easing, useSharedValue, withTiming } from "react-native-reanimated";
import { initialCollapse, nextCollapse } from "../lib/gestures";
import { useEvent } from "./useEvent";

/**
 * The bottom toolbar folding while the page scrolls down (`lib/gestures`): `collapse` animates
 * 0 → 1, `collapsed` is the settled state. It unfolds on each new page (`tabId`, `loadSeq`).
 */
export function useToolbarCollapse({ enabled, reduceMotion, tabId, loadSeq }: { enabled: boolean; reduceMotion: boolean; tabId?: string; loadSeq?: number }) {
  const collapse = useSharedValue(0);
  const state = useRef(initialCollapse);
  const [collapsed, setCollapsed] = useState(false);

  const apply = useCallback(
    (value: boolean) => {
      collapse.value = withTiming(value ? 1 : 0, { duration: reduceMotion ? 0 : 220, easing: Easing.out(Easing.cubic) });
      setCollapsed(value);
    },
    [collapse, reduceMotion],
  );

  const expand = useCallback(() => {
    state.current = initialCollapse;
    apply(false);
  }, [apply]);

  const onPageScroll = useEvent((y: number, contentHeight: number, viewportHeight: number) => {
    if (!enabled) return;
    const next = nextCollapse(state.current, y, contentHeight, viewportHeight);
    state.current = next;
    if (next.collapsed !== collapsed) apply(next.collapsed);
  });

  useEffect(() => {
    expand();
  }, [tabId, loadSeq, expand]);

  return { collapse, collapsed, expand, onPageScroll };
}
