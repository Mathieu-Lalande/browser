import { useEffect, useMemo, useRef, type ComponentRef } from "react";
import type { View } from "react-native";
import { SETTLE_MS, canCaptureTab } from "../lib/thumbnails";
import { isPrivateTab, type MobileTab } from "../lib/tabs";
import { useStore } from "../state/store";
import { captureThumbnail, loadThumbnails, retainThumbnails, thumbnails } from "../state/thumbnails";
import { useEvent } from "./useEvent";

/**
 * Thumbnails of the overview cards (ADR-055): the page view on screen is captured once a page has
 * settled and when the user leaves the tab (`captureNow` before the overview opens or a swipe);
 * never a private tab. Closed tabs drop theirs.
 */
export function useTabThumbnails({ tab, tabs, visible }: { tab: MobileTab | null; tabs: readonly MobileTab[]; visible: boolean }) {
  const pageRef = useRef<ComponentRef<typeof View> | null>(null);
  const all = useStore(thumbnails);

  useEffect(() => loadThumbnails(), []);

  const captureNow = useEvent(() => {
    if (!tab || !canCaptureTab(tab, isPrivateTab(tab))) return Promise.resolve();
    return captureThumbnail(tab.id, pageRef);
  });

  // After a load, once the page has had time to draw.
  const tabId = tab?.id;
  const ready = !!tab && visible && canCaptureTab(tab, isPrivateTab(tab));
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void captureNow(), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [ready, tabId, tab?.url, captureNow]);

  const ids = useMemo(() => new Set(tabs.filter((candidate) => !isPrivateTab(candidate)).map((candidate) => candidate.id)), [tabs]);
  useEffect(() => retainThumbnails(ids), [ids]);

  return { pageRef, thumbnails: all, captureNow };
}
