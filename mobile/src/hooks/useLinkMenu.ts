import { t } from "@shared/i18n";
import { displayUrl } from "@shared/url";
import type { MenuItem, MenuSpec } from "../components/ActionSheet";
import type { PeekRequest } from "../components/PeekSheet";
import type { LinkMenuRequest } from "../lib/linkMenu";
import type { BrowserActions } from "../state/BrowserProvider";
import type { Theme } from "../state/theme";
import { useEvent } from "./useEvent";

/**
 * Long press on a link of the page: its sheet (peek, open in a new / background / private tab,
 * copy, share). Nothing while another sheet or screen is up (`busy`).
 */
export function useLinkMenu({
  busy,
  isPrivate,
  tabId,
  actions,
  haptic,
  setMenu,
  setPeek,
  copy,
  share,
  downloadLink,
}: {
  busy: boolean;
  isPrivate: boolean;
  tabId: string | undefined;
  actions: BrowserActions;
  haptic: Theme["haptic"];
  setMenu: (menu: MenuSpec) => void;
  setPeek: (peek: PeekRequest) => void;
  copy: (text: string) => void;
  share: (url: string, title?: string) => void;
  /** "Télécharger le lien" (ADR-055). */
  downloadLink?: (url: string, isPrivate: boolean) => void;
}) {
  return useEvent((_tabId: string, request: LinkMenuRequest) => {
    if (busy) return;
    haptic("medium");
    const items: MenuItem[] = [
      { key: "peek", label: t("mobile.useLinkMenu.preview"), icon: "eye", onPress: () => setPeek({ url: request.url, isPrivate, afterId: tabId }) },
      { key: "open", label: t("mobile.useLinkMenu.openNewTab"), icon: "plus", onPress: () => void actions.openUrl(request.url, { private: isPrivate, afterId: tabId }) },
      {
        key: "background",
        label: t("mobile.useLinkMenu.openBackground"),
        icon: "tabs",
        onPress: () => void actions.openUrl(request.url, { private: isPrivate, background: true, afterId: tabId }),
      },
    ];
    if (!isPrivate) items.push({ key: "private", label: t("mobile.useLinkMenu.openPrivateTab"), icon: "mask", onPress: () => void actions.openUrl(request.url, { private: true }) });
    items.push(
      { key: "copy", label: t("mobile.useLinkMenu.copyLink"), icon: "link", onPress: () => copy(request.url) },
      { key: "share", label: t("mobile.useLinkMenu.shareLink"), icon: "share", onPress: () => share(request.url, request.text) },
    );
    if (downloadLink) items.push({ key: "download", label: t("mobile.useLinkMenu.downloadLink"), icon: "download", onPress: () => downloadLink(request.url, isPrivate) });
    setMenu({ title: request.text || displayUrl(request.url), subtitle: request.url, siteUrl: request.url, items });
  });
}
