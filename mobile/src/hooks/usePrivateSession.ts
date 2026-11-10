import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { WebSession } from "../../modules/web-session";
import { PrivateSessionTracker, privateIsolation } from "../lib/privateSession";
import { isPrivateTab, type MobileTab } from "../lib/tabs";
import { clearPrivateDownloads } from "../state/downloads";

/**
 * End of the private session (ADR-055): when the last private tab closes, its downloads are
 * deleted and, on Android, its web data: the private profile, or (WebView without profiles) the
 * storage and cookies of every site it visited. Also once at start-up (nothing private survives).
 */
export function usePrivateSession(tabs: readonly MobileTab[]): void {
  const tracker = useRef(new PrivateSessionTracker());

  useEffect(() => {
    if (Platform.OS === "android" && WebSession?.privateProfiles()) WebSession.clearPrivateProfile().catch(() => {});
  }, []);

  useEffect(() => {
    const ended = tracker.current.update(tabs.filter(isPrivateTab).map((tab) => tab.url));
    if (!ended) return;
    clearPrivateDownloads();
    if (Platform.OS !== "android" || !WebSession) return;
    const isolation = privateIsolation(Platform.OS, WebSession.privateProfiles());
    if (isolation === "profile") WebSession.clearPrivateProfile().catch(() => {});
    else if (isolation === "shared" && ended.length) WebSession.clearOrigins(ended).catch(() => {});
  }, [tabs]);
}
