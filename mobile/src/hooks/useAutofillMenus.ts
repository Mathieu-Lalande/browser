import { t } from "@shared/i18n";
import { CARD_BRAND_LABELS, addressSummary, byRecentUse, maskCardNumber } from "@shared/autofill";
import { useState } from "react";
import type { MenuSpec } from "../components/ActionSheet";
import type { AutofillChoice } from "../lib/autofill";
import { isPrivateTab, type MobileTab } from "../lib/tabs";
import { autofill, useAutofill } from "../state/autofill";
import { useEvent } from "./useEvent";

/**
 * Autofill in the browser screen (ADR-041): the page menu's "Remplir une adresse / une carte"
 * sheets, and the fill request handed to the tab's WebView. Nothing in a private tab.
 */
export function useAutofillMenus(tab: MobileTab | null) {
  const data = useAutofill();
  const [requests, setRequests] = useState<Record<string, { seq: number; choice: AutofillChoice }>>({});
  const usable = !!tab && !tab.interstitial && !isPrivateTab(tab) && /^https?:/i.test(tab.url);
  const sections: ("address" | "card")[] = usable ? [...(data.addresses.length ? (["address"] as const) : []), ...(data.cards.length ? (["card"] as const) : [])] : [];

  const fill = useEvent((choice: AutofillChoice) => {
    if (!tab) return;
    setRequests((current) => ({ ...current, [tab.id]: { seq: (current[tab.id]?.seq ?? 0) + 1, choice } }));
    void autofill.used(choice.section, choice.entry.id);
  });

  const menu = useEvent((section: "address" | "card"): MenuSpec | null => {
    if (!usable) return null;
    if (section === "card") {
      return {
        title: t("mobile.useAutofillMenus.fillPaymentCard"),
        note: t("mobile.useAutofillMenus.securityCodeNeverSaved"),
        items: byRecentUse(data.cards).map((card) => ({
          key: card.id,
          label: `${card.nickname || CARD_BRAND_LABELS.unknown} ${maskCardNumber(card.number.slice(-4))}`,
          icon: "credit-card" as const,
          onPress: () => fill({ section: "card", entry: card }),
        })),
      };
    }
    return {
      title: t("mobile.useAutofillMenus.fillAddress"),
      items: byRecentUse(data.addresses).map((address) => ({
        key: address.id,
        label: address.name ? `${address.name}, ${addressSummary(address)}` : addressSummary(address),
        icon: "map-pin" as const,
        onPress: () => fill({ section: "address", entry: address }),
      })),
    };
  });

  return { requests, sections, menu };
}
