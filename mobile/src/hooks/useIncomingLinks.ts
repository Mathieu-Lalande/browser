import { requireOptionalNativeModule } from "expo";
import { useShareIntent } from "expo-share-intent";
import * as QuickActions from "expo-quick-actions";
import { useEffect } from "react";
import { Linking, Platform } from "react-native";
import { createIncomingLinkHandler } from "../lib/incomingUrl";
import { parseQuickAction, quickActionItems, sharedContentTarget, type LaunchAction } from "../lib/launchActions";
import { useEvent } from "./useEvent";

/** Absent in Expo Go and on the web: the share target then stays off (`disabled`). */
const SHARE_TARGET = Platform.OS !== "web" && !!requireOptionalNativeModule("ExpoShareIntentModule");

/**
 * Links opened with the app (default browser, `browser-mobile://open?url=…`) and pages or text
 * shared to it ("Browser" in the system share sheet, ADR-055): each opens a new tab (a search for
 * plain text).
 */
export function useIncomingLinks(open: (url: string) => void, search?: (text: string) => void): void {
  const onOpen = useEvent(open);
  const onSearch = useEvent((text: string) => search?.(text));
  useEffect(() => {
    // On the web, the "initial URL" is the page serving the app itself.
    if (Platform.OS === "web") return;
    const handler = createIncomingLinkHandler(onOpen);
    Linking.getInitialURL()
      .then((url) => handler.initial(url))
      .catch(() => {});
    const subscription = Linking.addEventListener("url", ({ url }) => handler.event(url));
    return () => subscription.remove();
  }, [onOpen]);

  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ disabled: !SHARE_TARGET, resetOnBackground: true });
  useEffect(() => {
    if (!hasShareIntent) return;
    const target = sharedContentTarget(shareIntent);
    resetShareIntent();
    if (target?.kind === "url") onOpen(target.url);
    else if (target?.kind === "search") onSearch(target.text);
  }, [hasShareIntent, shareIntent, resetShareIntent, onOpen, onSearch]);
}

let initialHandled = false;

/**
 * Home screen quick actions (ADR-055): New tab, Private tab, Search. Set at start-up in the
 * interface language (the screen is rebuilt when the language changes); nothing in Expo Go.
 */
export function useQuickActions(run: (action: LaunchAction) => void): void {
  const onAction = useEvent(run);
  useEffect(() => {
    if (Platform.OS === "web") return;
    QuickActions.setItems(quickActionItems(Platform.OS)).catch(() => {});
    // The action that launched the app runs once, not again when the screen is rebuilt.
    const initial = initialHandled ? null : parseQuickAction(QuickActions.initial);
    initialHandled = true;
    if (initial) onAction(initial);
    const subscription = QuickActions.addListener((action) => {
      const parsed = parseQuickAction(action);
      if (parsed) onAction(parsed);
    });
    return () => subscription.remove();
  }, [onAction]);
}
