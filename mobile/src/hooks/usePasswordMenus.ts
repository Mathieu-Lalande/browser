import { originLabel, type PasswordCapture } from "@shared/passwords";
import { useMemo } from "react";
import type { MenuSpec } from "../components/ActionSheet";
import { isPrivateTab, type MobileTab, type TabsModel } from "../lib/tabs";
import type { BrowserActions } from "../state/BrowserProvider";
import { passwords, usePasswords } from "../state/passwords";
import type { Theme } from "../state/theme";
import { useEvent } from "./useEvent";

/**
 * Passwords in the browser screen (ADR-025): the accounts saved for the page (`tabPasswords`,
 * `passwordsMenu` fills one in), and the "save this password?" sheet after a login (`onCapture`).
 */
export function usePasswordMenus({
  tab,
  model,
  busy,
  actions,
  haptic,
  setMenu,
}: {
  tab: MobileTab | null;
  model: TabsModel;
  busy: boolean;
  actions: BrowserActions;
  haptic: Theme["haptic"];
  setMenu: (menu: MenuSpec) => void;
}) {
  const vault = usePasswords();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tabPasswords = useMemo(() => (tab && !tab.interstitial ? passwords.forUrl(tab.url) : []), [vault, tab?.url, tab?.interstitial]);

  /** A login was submitted in a normal tab: offer to save or update its password. */
  const onCapture = useEvent((tabId: string, capture: PasswordCapture) => {
    const target = model.tabs.find((candidate) => candidate.id === tabId);
    if (!target || isPrivateTab(target) || tabId !== tab?.id || busy) return;
    const outcome = passwords.outcome(capture);
    if (outcome !== "new" && outcome !== "update") return;
    const site = originLabel(capture.origin);
    const verb = outcome === "update" ? "Mettre à jour" : "Enregistrer";
    haptic("light");
    setMenu({
      title: `${verb} le mot de passe pour ${site} ?`,
      subtitle: capture.username || "Sans identifiant",
      note: "Chiffré et enregistré sur cet appareil uniquement.",
      items: [
        {
          key: "save",
          label: verb,
          icon: "key",
          onPress: () => {
            void passwords.save(capture);
            haptic("success");
          },
        },
        { key: "never", label: "Jamais pour ce site", icon: "ban", onPress: () => void passwords.never(capture.origin) },
        { key: "later", label: "Plus tard", icon: "close", onPress: () => {} },
      ],
    });
  });

  /** Accounts saved for the page (key button, page menu): a tap fills the login form. */
  const passwordsMenu = useEvent((): MenuSpec | null => {
    if (!tab || tabPasswords.length === 0) return null;
    return {
      title: `Mots de passe pour ${originLabel(tabPasswords[0].origin)}`,
      siteUrl: tab.url,
      items: tabPasswords.map((entry) => ({
        key: entry.id,
        label: entry.username || "Sans identifiant",
        icon: "key" as const,
        onPress: () => {
          actions.fillPassword(entry);
          // "Last used" is not recorded from a private tab.
          if (!isPrivateTab(tab)) void passwords.used(entry.id);
        },
      })),
    };
  });

  const showPasswords = useEvent(() => {
    const spec = passwordsMenu();
    if (spec) setMenu(spec);
  });

  return { tabPasswords, onCapture, passwordsMenu, showPasswords };
}
