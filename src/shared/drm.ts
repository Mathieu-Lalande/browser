/**
 * Protected content (Widevine DRM, ADR-040): what the settings row shows. Pure: main builds it
 * from castLabs' `components` API (Electron for Content Security).
 */

/**
 * - `ready`: the Widevine CDM is installed (`version` set);
 * - `installing`: being downloaded by the component updater (first launch);
 * - `unavailable`: no CDM (stock Electron build, download failed, unsupported platform);
 * - `disabled`: the user turned protected content off.
 */
import { t as tr, t } from "./i18n";

export type WidevineState = "ready" | "installing" | "unavailable" | "disabled";

export interface WidevineStatus {
  state: WidevineState;
  /** CDM version when installed (e.g. "4.10.2891.0"). */
  version: string | null;
  /** Whether a restart is needed before pages can use a freshly installed CDM (Linux). */
  restartNeeded: boolean;
}

/** A component's status as castLabs' `components.status()` reports it. */
export interface ComponentInfo {
  status: string;
  title: string | null;
  version: string | null;
}

export interface WidevineFacts {
  /** The user setting `privacy.protectedContent`. */
  enabled: boolean;
  /** Whether this Electron build has the `components` API (castLabs ECS). */
  supported: boolean;
  /** The Widevine entry of `components.status()`, if any. */
  component: ComponentInfo | null;
  /** Whether `components.whenReady()` is still pending. */
  pending: boolean;
  /** The CDM was installed during this run (Linux only loads it at the next start). */
  installedThisRun: boolean;
  platform: string;
}

const VERSION = /^\d+(\.\d+){1,3}$/;

export function widevineStatus(facts: WidevineFacts): WidevineStatus {
  const raw = facts.component?.version ?? "";
  // The component updater reports "0.0.0.0" for a registered but not yet installed component.
  const version = VERSION.test(raw) && /[1-9]/.test(raw) ? raw : null;
  const restartNeeded = version !== null && facts.installedThisRun && facts.platform === "linux";
  if (!facts.enabled) return { state: "disabled", version, restartNeeded: false };
  if (!facts.supported) return { state: "unavailable", version: null, restartNeeded: false };
  if (version) return { state: "ready", version, restartNeeded };
  return { state: facts.pending ? "installing" : "unavailable", version: null, restartNeeded: false };
}

/** The settings row's text. */
export function widevineLabel(status: WidevineStatus | null): string {
  if (!status) return "…";
  switch (status.state) {
    case "ready":
      return status.restartNeeded ? t("drm.widevineActiveNextStartup", { version: status.version }) : `Widevine ${status.version}`;
    case "installing":
      return t("drm.widevineInstalling");
    case "disabled":
      return t("drm.off");
    default:
      return tr("drm.widevineUnavailable");
  }
}
