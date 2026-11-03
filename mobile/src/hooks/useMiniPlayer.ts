import type { MediaProbe } from "@shared/media";
import { useState } from "react";
import { miniBarOf } from "../lib/media";
import type { MobileTab } from "../lib/tabs";
import type { BrowserActions } from "../state/BrowserProvider";
import { useEvent } from "./useEvent";

/** Mini-player (ADR-035): the media of the page on screen only (`tab`, when `shown`). */
export function useMiniPlayer({ tab, shown, actions }: { tab: MobileTab | null; shown: boolean; actions: BrowserActions }) {
  const [media, setMedia] = useState<{ tabId: string; probe: MediaProbe | null; dismissed: boolean } | null>(null);

  const onMedia = useEvent((tabId: string, probe: MediaProbe | null) => {
    setMedia((previous) => {
      if (!probe) return previous?.tabId === tabId ? null : previous;
      // "Fermer" holds until the page plays again.
      const dismissed = previous?.tabId === tabId && previous.dismissed && probe.element?.paused !== false;
      return { tabId, probe, dismissed };
    });
  });

  const miniBar = tab && media?.tabId === tab.id && shown ? miniBarOf(media.probe, tab, media.dismissed) : null;

  const toggle = useEvent(() => {
    if (media) actions.controlMedia(media.tabId, "toggle");
  });
  const close = useEvent(() => {
    if (!media) return;
    actions.controlMedia(media.tabId, "pause");
    setMedia({ ...media, dismissed: true });
  });

  return { onMedia, miniBar, toggle, close };
}
