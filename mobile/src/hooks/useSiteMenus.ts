import { boostHostOf, type Boost } from "@shared/boosts";
import type { MenuItem, MenuSpec } from "../components/ActionSheet";
import { QUICK_FILTERS, ensureSiteBoost, filterOn, fontLabel, nextFont, removeZap, siteBoost, toggleFilter, upsertBoost } from "../lib/boosts";
import { privacySummary } from "../lib/privacyStats";
import { SHIELD_UNAVAILABLE_NOTE, shieldOffFor, shieldSiteOf, toggleShieldSite } from "../lib/shields";
import { connectionLabel, mobileSiteInfo, SITE_DATA_NOTE } from "../lib/siteInfo";
import type { MobileTab } from "../lib/tabs";
import { newId, type BrowserActions } from "../state/BrowserProvider";
import type { Theme } from "../state/theme";
import { useEvent } from "./useEvent";

/** Sheets about the page's site: its info (ADR-021) and its boost (ADR-029). */
export function useSiteMenus({
  tab,
  boosts,
  actions,
  haptic,
  setMenu,
  copy,
  shieldsOff,
  blocker,
  nativeBlocking,
}: {
  tab: MobileTab | null;
  boosts: Boost[];
  actions: BrowserActions;
  haptic: Theme["haptic"];
  setMenu: (menu: MenuSpec) => void;
  copy: (text: string) => void;
  /** Sites where the shield is off (ADR-051). */
  shieldsOff: readonly string[];
  /** The blocker setting. */
  blocker: boolean;
  /** Whether requests are blocked natively (compiled app) or only elements hidden (Expo Go). */
  nativeBlocking: boolean;
}) {
  /** Site info sheet (tap on the lock): connection, host, copy link, clear the site's data. */
  const siteInfoMenu = useEvent((): MenuSpec | null => {
    const info = tab ? mobileSiteInfo(tab.url) : null;
    if (!tab || !info) return null;
    const url = tab.url;
    // "Bouclier" (ADR-051): the shield of this site, switched off and on here; the page reloads.
    const site = shieldSiteOf(info.host);
    const off = shieldOffFor(info.host, shieldsOff);
    const counts = site ? privacySummary(site).totals : null;
    const shieldNote = !blocker
      ? "Bloqueur de pubs et traqueurs désactivé dans les réglages."
      : off
        ? `Bouclier désactivé sur ${site} : publicités, traqueurs et bandeaux cookies ne sont plus bloqués ici.`
        : [
            counts && counts.trackers ? `${counts.trackers} traqueur${counts.trackers > 1 ? "s" : ""} bloqué${counts.trackers > 1 ? "s" : ""} sur ce site en 30 jours.` : "",
            counts && counts.cookieBanners ? `Bandeaux cookies refusés : ${counts.cookieBanners}.` : "",
            nativeBlocking ? "" : `${SHIELD_UNAVAILABLE_NOTE} ; ici, seuls les éléments publicitaires sont masqués.`,
          ]
            .filter(Boolean)
            .join(" ");
    const shieldItem: MenuItem[] =
      blocker && site
        ? [
            {
              key: "shield",
              label: off ? "Réactiver le bouclier sur ce site" : "Désactiver le bouclier sur ce site",
              icon: off ? "shield" : "shield-off",
              onPress: () => {
                actions.updateMobileSettings({ shieldsOff: toggleShieldSite(shieldsOff, site, !off) });
                haptic("selection");
                // Native rules apply from the next load (iOS recompiles the lists first).
                setTimeout(() => actions.reload(), 300);
              },
            },
          ]
        : [];
    return {
      title: info.host,
      subtitle: connectionLabel(info),
      siteUrl: url,
      note: shieldNote ? `${shieldNote}\n\n${SITE_DATA_NOTE}` : SITE_DATA_NOTE,
      items: [
        ...shieldItem,
        { key: "copy", label: "Copier le lien", icon: "link", onPress: () => copy(url) },
        {
          key: "clear",
          label: "Effacer les données du site",
          icon: "trash",
          destructive: true,
          onPress: () => ({
            title: `Effacer les données de ${info.host} ?`,
            subtitle: "Vous pourriez être déconnecté de ce site. La page sera rechargée.",
            items: [
              {
                key: "confirm",
                label: "Effacer et recharger",
                icon: "trash",
                destructive: true,
                onPress: () => {
                  actions.clearSiteData();
                  haptic("success");
                },
              },
              { key: "cancel", label: "Annuler", icon: "close", onPress: () => {} },
            ],
          }),
        },
      ],
    };
  });

  const showSiteInfo = useEvent(() => {
    const spec = siteInfoMenu();
    if (spec) setMenu(spec);
  });

  /**
   * Per-site boost toggles: the site's boost (created on first change), quick filters, font,
   * zapped elements to show again. Each change re-opens the sheet with the new state.
   */
  const boostMenu = useEvent((current?: Boost): MenuSpec | null => {
    const url = tab?.url ?? "";
    const host = boostHostOf(url);
    if (!tab || !host) return null;
    const boost = current ?? siteBoost(boosts, url);
    const change = (update: (boost: Boost) => Boost): MenuSpec | null => {
      const id = newId();
      const ensured = ensureSiteBoost(boosts, url, host, id, Date.now());
      const next = update(boost ?? ensured.boost);
      actions.setBoosts((list) => upsertBoost(list.some((item) => item.id === next.id) ? list : ensured.boosts, next));
      haptic("selection");
      return boostMenu(next);
    };
    const on = (value: boolean) => (value ? " : activé" : "");
    const items: MenuItem[] = [];
    if (boost) {
      items.push({ key: "enabled", label: boost.enabled ? "Désactiver le boost" : "Activer le boost", icon: "rocket", onPress: () => change((b) => ({ ...b, enabled: !b.enabled, updatedAt: Date.now() })) ?? undefined });
    }
    for (const filter of QUICK_FILTERS) {
      items.push({ key: filter.key, label: `${filter.label}${on(!!boost && filterOn(boost, filter.key))}`, icon: "palette", onPress: () => change((b) => toggleFilter(b, filter.key, Date.now())) ?? undefined });
    }
    items.push({ key: "font", label: `Police : ${fontLabel(boost?.font ?? null)}`, icon: "textSize", onPress: () => change((b) => ({ ...b, font: nextFont(b.font), updatedAt: Date.now() })) ?? undefined });
    for (const selector of boost?.zaps ?? []) {
      items.push({ key: `zap:${selector}`, label: `Réafficher ${selector}`, icon: "undo", onPress: () => change((b) => removeZap(b, selector, Date.now())) ?? undefined });
    }
    return {
      title: `Boost de ${host}`,
      subtitle: boost ? (boost.enabled ? boost.match : `${boost.match} · désactivé`) : "Aucun boost pour ce site",
      note: "Pour masquer des éléments d'une page, utilisez l'outil de la version ordinateur : les boosts sont synchronisés.",
      items,
    };
  });

  return { siteInfoMenu, showSiteInfo, boostMenu };
}
