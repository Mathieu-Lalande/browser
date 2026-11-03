import { useEffect } from "react";
import { Linking, Platform } from "react-native";
import { createIncomingLinkHandler } from "../lib/incomingUrl";
import { useEvent } from "./useEvent";

/** Links opened with the app (default browser, `browser-mobile://open?url=…`): each opens a new tab. */
export function useIncomingLinks(open: (url: string) => void): void {
  const onOpen = useEvent(open);
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
}
