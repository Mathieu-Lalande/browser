import { useEffect, useMemo, useRef } from "react";
import type { BannerResult } from "@shared/cookie-banners";
import type { Settings } from "@shared/settings";
import { ContentBlocker } from "../../modules/content-blocker";
import type { MobileSettings } from "../lib/mobileSettings";
import { loadPrivacyStats, recordPrivacyEvents } from "../lib/privacyStats";
import { bannerEvent, blockedEvents, type TabShield } from "../lib/shields";
import { isPrivateTab, type MobileTab } from "../lib/tabs";
import { useEvent } from "./useEvent";

/**
 * The shield (ADR-051) for the browser screen: one stable `TabShield` per settings change, the
 * native blocker kept in step (absent in Expo Go), and the counters fed from both (never for
 * private tabs).
 */
export function useShield({ mobile, settings, tabs }: { mobile: MobileSettings; settings: Settings; tabs: readonly MobileTab[] }) {
  const shield = useMemo<TabShield>(
    () => ({
      blocker: mobile.contentBlocker,
      sitesOff: mobile.shieldsOff,
      cookieBanners: settings.privacy.cookieBanners,
      bannerExceptions: settings.privacy.cookieBannerExceptions,
    }),
    [mobile.contentBlocker, mobile.shieldsOff, settings.privacy.cookieBanners, settings.privacy.cookieBannerExceptions],
  );

  useEffect(() => {
    void loadPrivacyStats();
  }, []);

  useEffect(() => {
    ContentBlocker?.apply(mobile.contentBlocker, mobile.shieldsOff).catch(() => {});
  }, [mobile.contentBlocker, mobile.shieldsOff]);

  // Hosts of private tabs' pages: their blocked requests are not counted (the native side cannot tell).
  const privateHosts = useRef<Set<string>>(new Set());
  privateHosts.current = new Set(
    tabs
      .filter(isPrivateTab)
      .map((tab) => {
        try {
          return new URL(tab.url).hostname.toLowerCase();
        } catch {
          return "";
        }
      }),
  );
  useEffect(() => {
    if (!ContentBlocker?.counts) return;
    const subscription = ContentBlocker.addListener("onBlocked", ({ events }) => recordPrivacyEvents(blockedEvents(events ?? [], privateHosts.current)));
    return () => subscription.remove();
  }, []);

  /** Given to normal tabs only. */
  const onCookieBanner = useEvent((_tabId: string, url: string, result: BannerResult) => {
    let host: string | null = null;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return;
    }
    const event = bannerEvent(host, result);
    if (event) recordPrivacyEvents([event]);
  });

  return { shield, onCookieBanner, nativeBlocking: ContentBlocker !== null };
}
