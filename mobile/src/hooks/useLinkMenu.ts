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
}) {
  return useEvent((_tabId: string, request: LinkMenuRequest) => {
    if (busy) return;
    haptic("medium");
    const items: MenuItem[] = [
      { key: "peek", label: "Aperçu", icon: "eye", onPress: () => setPeek({ url: request.url, isPrivate, afterId: tabId }) },
      { key: "open", label: "Ouvrir dans un nouvel onglet", icon: "plus", onPress: () => void actions.openUrl(request.url, { private: isPrivate, afterId: tabId }) },
      {
        key: "background",
        label: "Ouvrir en arrière-plan",
        icon: "tabs",
        onPress: () => void actions.openUrl(request.url, { private: isPrivate, background: true, afterId: tabId }),
      },
    ];
    if (!isPrivate) items.push({ key: "private", label: "Ouvrir dans un onglet privé", icon: "mask", onPress: () => void actions.openUrl(request.url, { private: true }) });
    items.push(
      { key: "copy", label: "Copier le lien", icon: "link", onPress: () => copy(request.url) },
      { key: "share", label: "Partager le lien", icon: "share", onPress: () => share(request.url, request.text) },
    );
    setMenu({ title: request.text || displayUrl(request.url), subtitle: request.url, siteUrl: request.url, items });
  });
}
