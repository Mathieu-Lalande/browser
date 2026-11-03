import { useMemo } from "react";
import { interpolate, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { settle } from "../lib/motion";
import { swipeTarget, type TabsModel } from "../lib/tabs";
import type { Theme } from "../state/theme";
import { useEvent } from "./useEvent";

/**
 * Horizontal swipe on the address bar between the tabs of the space (ADR-031): the page slides in
 * from the side (`shiftStyle`), past the last tab a new tab opens (`onNewTab`).
 */
export function usePageSwipe({
  model,
  width,
  reduceMotion,
  haptic,
  onActivate,
  onNewTab,
}: {
  model: TabsModel;
  width: number;
  reduceMotion: boolean;
  haptic: Theme["haptic"];
  onActivate: (id: string) => void;
  onNewTab: () => void;
}) {
  const shift = useSharedValue(0);
  const shiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shift.value }],
    opacity: interpolate(Math.abs(shift.value), [0, width * 0.3], [1, 0.4], "clamp"),
  }));

  const canSwipe = useMemo(() => ({ previous: swipeTarget(model, -1) !== null, next: swipeTarget(model, 1) !== null }), [model]);

  const onSwipeTab = useEvent((direction: 1 | -1) => {
    const destination = swipeTarget(model, direction);
    if (!destination) return;
    haptic("light");
    if (!reduceMotion) {
      shift.value = direction * width * 0.3;
      shift.value = settle(0, false);
    }
    if (destination.kind === "tab") onActivate(destination.id);
    else onNewTab();
  });

  return { shiftStyle, canSwipe, onSwipeTab };
}
