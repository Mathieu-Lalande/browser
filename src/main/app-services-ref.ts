import type { AppServices } from "./services";

/**
 * Holds the `AppServices` instance, apart from `services.ts`: the module facades (`passwords/vault.ts`,
 * `reader/index.ts`, `start-image.ts`…) reach their service through `appServices()` without importing
 * the module that imports their implementation (no import cycle). The import above is type-only.
 */
let current: AppServices | null = null;

/** Set once by `buildAppServices` (startup). */
export function setAppServices(services: AppServices): void {
  if (current) throw new Error("App services are already built");
  current = services;
}

/** The app services; only once `buildAppServices` ran (the app is ready). */
export function appServices(): AppServices {
  if (!current) throw new Error("App services used before startup (buildAppServices)");
  return current;
}
