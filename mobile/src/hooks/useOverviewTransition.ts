import { useMemo, useState } from "react";
import { interpolate, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { settleConfig } from "../lib/motion";
import { scheduleOnRN } from "react-native-worklets";
import { initialScroll, overviewGeometry, overviewTarget } from "../components/TabOverview";
import type { Rect } from "../lib/overviewLayout";
import type { TabsModel } from "../lib/tabs";
import { useEvent } from "./useEvent";

/**
 * The tab overview's zoom (ADR-022): the page shrinks into its card of the grid (`pageStyle`),
 * the toolbar fades away (`barStyle`); closing zooms the chosen card back to full screen.
 * `onOpened` runs as the zoom starts, `onClosed` once the page is back.
 */
export function useOverviewTransition({
  model,
  tabId,
  width,
  height,
  insets,
  pageTop,
  pageHeight,
  hasPinned,
  hasFavorites,
  reduceMotion,
  onOpened,
  onClosed,
  onActivate,
}: {
  model: TabsModel;
  tabId: string | null;
  width: number;
  height: number;
  insets: { top: number; bottom: number };
  pageTop: number;
  pageHeight: number;
  hasPinned: boolean;
  hasFavorites: boolean;
  reduceMotion: boolean;
  onOpened: () => void;
  onClosed: () => void;
  onActivate: (id: string) => void;
}) {
  const progress = useSharedValue(0);
  const target = useSharedValue<Rect>({ x: 0, y: pageTop, width, height: pageHeight });
  const gridScrollY = useSharedValue(0);
  const [initialScrollY, setInitialScrollY] = useState(0);
  const geometry = useMemo(
    () => overviewGeometry(width, height, insets.top, insets.bottom, hasPinned, hasFavorites),
    [width, height, insets.top, insets.bottom, hasPinned, hasFavorites],
  );
  // Short ease-out, no overshoot (`lib/motion`).
  const timing = settleConfig(reduceMotion);

  const open = useEvent(() => {
    const scroll = initialScroll(geometry, model, tabId, insets.bottom);
    gridScrollY.value = scroll;
    setInitialScrollY(scroll);
    target.value = overviewTarget(geometry, model, tabId, scroll, width);
    onOpened();
    progress.value = withTiming(1, timing);
  });

  /** Back to the page of tab `id` (activated), or of the active tab. */
  const close = useEvent((id?: string) => {
    const destination = id ?? tabId;
    target.value = overviewTarget(geometry, model, destination, gridScrollY.value, width);
    if (id && id !== tabId) onActivate(id);
    progress.value = withTiming(0, timing, (finished) => {
      if (finished) scheduleOnRN(onClosed);
    });
  });

  /** The page shown at once, without the zoom (a new tab from the overview). */
  const reset = useEvent(() => {
    progress.value = 0;
  });

  const pageStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const t = target.value;
    const rx = interpolate(p, [0, 1], [0, t.x]);
    const ry = interpolate(p, [0, 1], [pageTop, t.y]);
    const rw = interpolate(p, [0, 1], [width, t.width]);
    const rh = interpolate(p, [0, 1], [pageHeight, t.height]);
    const scale = rw / width;
    return {
      height: rh / scale,
      borderRadius: interpolate(p, [0, 1], [0, 20]) / scale,
      opacity: interpolate(p, [0.86, 1], [1, 0], "clamp"),
      transform: [{ translateX: rx }, { translateY: ry - pageTop }, { scale }],
    };
  });
  const barStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.4], [1, 0], "clamp"),
    transform: [{ translateY: interpolate(progress.value, [0, 1], [0, reduceMotion ? 0 : 60]) }],
  }));

  return { geometry, progress, gridScrollY, initialScrollY, open, close, reset, pageStyle, barStyle };
}
