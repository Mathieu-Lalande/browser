import * as electron from "electron";
import { widevineStatus, type ComponentInfo, type WidevineStatus } from "@shared/drm";

/** Electron's permission for a page's `requestMediaKeySystemAccess` (DRM), decided by the setting. */
export const DRM_PERMISSION = "mediaKeySystem";

/** How long startup waits for the Widevine CDM before opening the windows anyway. */
export const WIDEVINE_WAIT_MS = 6000;

/** castLabs' `components` API (Electron for Content Security), seen through what we use. */
export interface ComponentsPort {
  readonly widevineId: string;
  /** Resolves when the CDM is installed (downloaded on first launch), rejects if it cannot be. */
  whenReady(): Promise<unknown>;
  status(): Record<string, ComponentInfo>;
}

interface CastlabsComponents {
  WIDEVINE_CDM_ID: string;
  whenReady(required?: string[]): Promise<unknown>;
  status(): Record<string, ComponentInfo>;
}

/**
 * The `components` API when Electron is castLabs' ECS build (ADR-040), null with stock Electron
 * (the dependency switched back) or when the component updater is off
 * (`--disable-component-update`, used by the e2e tests: no download, no wait).
 */
export function castlabsComponents(): ComponentsPort | null {
  const components = (electron as unknown as { components?: CastlabsComponents }).components;
  if (!components || typeof components.whenReady !== "function") return null;
  if (electron.app.commandLine.hasSwitch("disable-component-update")) return null;
  return {
    widevineId: components.WIDEVINE_CDM_ID,
    whenReady: () => components.whenReady([components.WIDEVINE_CDM_ID]),
    status: () => components.status(),
  };
}

export interface WidevineDeps {
  components: ComponentsPort | null;
  enabled(): boolean;
  platform: string;
}

/**
 * Widevine CDM installation and status (ADR-040). `prepare` runs once the app is ready and before
 * the windows open (castLabs: a page created before the CDM is registered cannot use it), but
 * never holds startup longer than `WIDEVINE_WAIT_MS`: without network or with stock Electron, the
 * browser starts all the same, without DRM.
 */
export class WidevineService {
  private pending = false;
  private installedThisRun = false;

  constructor(private readonly deps: WidevineDeps) {}

  async prepare(waitMs = WIDEVINE_WAIT_MS): Promise<void> {
    const { components } = this.deps;
    if (!components || !this.deps.enabled()) return;
    const before = this.component()?.version ?? null;
    this.pending = true;
    const install = components.whenReady().then(
      () => {
        this.pending = false;
        if (!before && this.component()?.version) this.installedThisRun = true;
      },
      (error: unknown) => {
        this.pending = false;
        console.warn("Widevine indisponible :", error instanceof Error ? error.message : error);
      },
    );
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, waitMs)));
    await Promise.race([install, timeout]);
    clearTimeout(timer);
  }

  status(): WidevineStatus {
    return widevineStatus({
      enabled: this.deps.enabled(),
      supported: this.deps.components !== null,
      component: this.component(),
      pending: this.pending,
      installedThisRun: this.installedThisRun,
      platform: this.deps.platform,
    });
  }

  private component(): ComponentInfo | null {
    const { components } = this.deps;
    if (!components) return null;
    try {
      return components.status()[components.widevineId] ?? null;
    } catch {
      return null;
    }
  }
}
