import { t } from "@shared/i18n";
import { useEffect, useRef } from "react";
import { Alert, Platform } from "react-native";
import { WebSession } from "../../modules/web-session";
import type { MenuItem, MenuSpec } from "../components/ActionSheet";
import { canOpenDownload, downloadFileName, parseDownloadRequest, type DownloadRequest } from "../lib/downloads";
import { isPrivateTab, type MobileTab } from "../lib/tabs";
import { downloadFile, loadDownloads, openDownload, shareDownload, shareFile } from "../state/downloads";
import type { Theme } from "../state/theme";
import { useEvent } from "./useEvent";

/**
 * Downloads (ADR-055): from the link menu, from iOS `onFileDownload`, and from the Android
 * WebView's download listener (`web-session` module, matched to its tab by React tag; unknown
 * views are ignored). A normal tab's file is listed and offered (open / share / list); a private
 * tab's file is only offered through the share sheet.
 */
export function useDownloads({ tabs, haptic, setMenu, showList }: { tabs: readonly MobileTab[]; haptic: Theme["haptic"]; setMenu: (menu: MenuSpec) => void; showList: () => void }) {
  const tags = useRef(new Map<string, number>());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  useEffect(() => {
    loadDownloads().catch(() => {});
  }, []);

  const onNativeTag = useEvent((tabId: string, tag: number | null) => {
    if (tag === null) tags.current.delete(tabId);
    else tags.current.set(tabId, tag);
  });

  const start = useEvent(async (request: DownloadRequest, isPrivate: boolean, headers: Record<string, string> = {}) => {
    haptic("light");
    try {
      const { file, name, item } = await downloadFile(request, { isPrivate, headers });
      haptic("success");
      if (!item) {
        await shareFile(file, request.mimeType.split(";")[0]!.trim());
        return;
      }
      const items: MenuItem[] = [];
      if (canOpenDownload(item)) items.push({ key: "open", label: t("mobile.downloads.openFile"), icon: "open", onPress: () => void openDownload(item).catch(() => {}) });
      items.push(
        { key: "share", label: t("mobile.downloads.shareFile"), icon: "share", onPress: () => void shareDownload(item).catch(() => {}) },
        { key: "list", label: t("mobile.downloads.showAll"), icon: "download", onPress: showList },
      );
      setMenu({ title: t("mobile.downloads.done"), subtitle: name, items });
    } catch {
      haptic("warning");
      Alert.alert(t("mobile.downloads.failed"), t("mobile.downloads.failedDetail", { name: downloadFileName(request.url, request.contentDisposition, request.mimeType) }), [{ text: t("mobile.downloads.ok") }]);
    }
  });

  /** iOS: a file the WebView of `tabId` cannot show. */
  const onDownload = useEvent((tabId: string, request: DownloadRequest) => {
    const tab = tabsRef.current.find((candidate) => candidate.id === tabId);
    if (tab) void start(request, isPrivateTab(tab));
  });

  /** "Télécharger le lien" of the link menu. */
  const downloadLink = useEvent(async (url: string, isPrivate: boolean) => {
    const request = parseDownloadRequest({ url });
    if (!request) return;
    const cookie = WebSession ? await WebSession.cookieHeader(url, isPrivate).catch(() => "") : "";
    void start(request, isPrivate, cookie ? { Cookie: cookie } : {});
  });

  // Android: downloads handed over by the patched WebView.
  useEffect(() => {
    if (Platform.OS !== "android" || !WebSession) return;
    const subscription = WebSession.addListener("onDownload", (event) => {
      const tabId = [...tags.current].find(([, tag]) => tag === event.tag)?.[0];
      const tab = tabId ? tabsRef.current.find((candidate) => candidate.id === tabId) : undefined;
      const request = parseDownloadRequest(event);
      if (!tab || !request) return;
      const headers: Record<string, string> = {};
      if (event.cookie) headers.Cookie = event.cookie;
      if (event.userAgent) headers["User-Agent"] = event.userAgent;
      void start(request, isPrivateTab(tab), headers);
    });
    return () => subscription.remove();
  }, [start]);

  return { onNativeTag, onDownload, downloadLink };
}
