import type { Config } from "@ghostery/adblocker";

/**
 * Engine options. Extended (procedural) selectors and HTML filtering need code running inside the
 * page, which ADR-006 rules out, so they are not loaded at all.
 */
export const ENGINE_CONFIG: Partial<Config> = {
  loadNetworkFilters: true,
  loadCosmeticFilters: true,
  loadGenericCosmeticsFilters: true,
  loadExtendedSelectors: false,
  enableHtmlFiltering: false,
  enableMutationObserver: false,
};
