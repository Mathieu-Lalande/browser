/**
 * Desktop auto-updates (ADR-030): the status shown in the settings and the sidebar, and the pure
 * state machine that turns updater events into it. The updater itself (electron-updater, or a fake
 * in tests) lives in `src/main/updates/`.
 */

export const RELEASES_URL = "https://github.com/Mathieu-Lalande/browser/releases";

/** Where to download a version by hand (macOS without a signature, Linux .deb, portable zip). */
export function releasePageUrl(version?: string): string {
  return version && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version) ? `${RELEASES_URL}/tag/v${version}` : `${RELEASES_URL}/latest`;
}

export type UpdatePhase =
  /** No updates in this build (development, test, or turned off by `--disable-updates`). */
  | "disabled"
  /** Nothing checked yet. */
  | "idle"
  | "checking"
  | "up-to-date"
  /** Found, waiting for "Télécharger" (automatic download off). */
  | "available"
  | "downloading"
  /** Downloaded: installed on restart (or on quit). */
  | "ready"
  /** Found, but this installation cannot update itself: download it from the release page. */
  | "manual"
  | "error";

export interface UpdateStatus {
  phase: UpdatePhase;
  currentVersion: string;
  /** Version found (available, downloading, ready, manual). */
  version: string | null;
  /** Download progress, 0…100. */
  percent: number;
  /** Last completed check (ms since epoch), successful or not. */
  lastCheck: number | null;
  /** French message for the user, in the "error" phase. */
  error: string | null;
  /** Can this installation install updates itself? (false: "manual" instead of downloading). */
  canInstall: boolean;
  /** Release page of the version found, or of the latest release. */
  releaseUrl: string;
}

export type UpdateEvent =
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "not-available" }
  | { type: "download-started" }
  | { type: "progress"; percent: number }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string };

export function initialUpdateStatus(currentVersion: string, options: { enabled: boolean; canInstall: boolean }): UpdateStatus {
  return {
    phase: options.enabled ? "idle" : "disabled",
    currentVersion,
    version: null,
    percent: 0,
    lastCheck: null,
    error: null,
    canInstall: options.canInstall,
    releaseUrl: releasePageUrl(),
  };
}

const clampPercent = (value: number) => (Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0);

/**
 * Next status after an updater event. A downloaded update stays "ready" whatever later checks
 * say (it is installed on quit); a disabled updater ignores everything.
 */
export function reduceUpdateStatus(state: UpdateStatus, event: UpdateEvent, now: number): UpdateStatus {
  if (state.phase === "disabled") return state;
  const ready = state.phase === "ready";
  switch (event.type) {
    case "checking":
      return ready || state.phase === "downloading" ? state : { ...state, phase: "checking", error: null };
    case "not-available":
      return ready ? { ...state, lastCheck: now } : { ...state, phase: "up-to-date", version: null, percent: 0, lastCheck: now, error: null };
    case "available":
      if (ready && state.version === event.version) return { ...state, lastCheck: now };
      return {
        ...state,
        phase: state.canInstall ? "available" : "manual",
        version: event.version,
        percent: 0,
        lastCheck: now,
        error: null,
        releaseUrl: releasePageUrl(event.version),
      };
    case "download-started":
      return ready || !state.canInstall ? state : { ...state, phase: "downloading", percent: 0, error: null };
    case "progress":
      if (ready || !state.canInstall) return state;
      return { ...state, phase: "downloading", percent: Math.max(state.phase === "downloading" ? state.percent : 0, clampPercent(event.percent)) };
    case "downloaded":
      return { ...state, phase: "ready", version: event.version, percent: 100, error: null, releaseUrl: releasePageUrl(event.version) };
    case "error":
      // A failed check after a download keeps the downloaded update.
      if (ready) return { ...state, lastCheck: now };
      return { ...state, phase: "error", percent: 0, lastCheck: state.phase === "checking" ? now : state.lastCheck, error: event.message || "La mise à jour a échoué." };
  }
}

/** Status line of the settings, in French. */
export function updateStatusText(status: UpdateStatus): string {
  switch (status.phase) {
    case "disabled":
      return "Mises à jour automatiques indisponibles dans cette version.";
    case "idle":
      return "Pas encore vérifié.";
    case "checking":
      return "Recherche de mises à jour…";
    case "up-to-date":
      return `Browser est à jour (version ${status.currentVersion}).`;
    case "available":
      return `Version ${status.version} disponible.`;
    case "downloading":
      return `Téléchargement${status.version ? ` de la version ${status.version}` : ""} : ${status.percent} %`;
    case "ready":
      return `Version ${status.version} prête : redémarrez pour l'installer.`;
    case "manual":
      return `Version ${status.version} disponible : mise à jour manuelle requise.`;
    case "error":
      return status.error ?? "La mise à jour a échoué.";
  }
}

/** Busy phases, during which "Rechercher des mises à jour" is unavailable. */
export const isUpdateBusy = (status: UpdateStatus) => status.phase === "checking" || status.phase === "downloading" || status.phase === "disabled";

/** Delay before the first check after startup, then the interval between checks. */
export const UPDATE_STARTUP_DELAY_MS = 30_000;
export const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
