/**
 * Crash reports and bug reports (ADR-043), pure. Crash dumps always stay on the device (listed in
 * "Derniers plantages"); they are sent only when the user opts in AND the build has an endpoint:
 * a self-hosted receiver (`server/`, `POST /crash`) or a Sentry DSN, given at build time.
 */

/** Where crash reports go, from the build-time value (`MAIN_VITE_CRASH_ENDPOINT`). */
export interface CrashEndpoint {
  kind: "self-hosted" | "sentry";
  /** The `submitURL` Crashpad posts minidumps to. */
  url: string;
  /** Shown in the settings ("rapports envoyés à …"). */
  host: string;
}

/**
 * A build-time endpoint: an https URL (http only for localhost), or a Sentry DSN
 * (`https://<key>@<host>/<project>`), turned into Sentry's minidump endpoint. Anything else: none.
 */
export function parseCrashEndpoint(value: string | undefined | null): CrashEndpoint | null {
  const text = value?.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (url.username && !url.password) {
    const project = url.pathname.replace(/^\/+|\/+$/g, "");
    if (!/^\d+$/.test(project)) return null;
    const submit = `${url.protocol}//${url.host}/api/${project}/minidump/?sentry_key=${encodeURIComponent(url.username)}`;
    return { kind: "sentry", url: submit, host: url.hostname };
  }
  if (url.username || url.password) return null;
  url.hash = "";
  return { kind: "self-hosted", url: url.toString(), host: url.hostname };
}

/** What `crashReporter.start` receives: never more than the app's name and version. */
export interface CrashReporterOptions {
  productName: string;
  submitURL: string;
  uploadToServer: boolean;
  compress: boolean;
  ignoreSystemCrashHandler: boolean;
  /** Extra annotations: only the version and the channel (no URL, no profile data). */
  globalExtra: Record<string, string>;
}

export function crashReporterOptions(context: {
  enabled: boolean;
  endpoint: CrashEndpoint | null;
  productName: string;
  version: string;
  channel: string;
}): CrashReporterOptions {
  return {
    productName: context.productName,
    // Crashpad needs a URL even when nothing is uploaded: an unroutable placeholder then.
    submitURL: context.endpoint?.url ?? "https://localhost.invalid/crash",
    uploadToServer: context.enabled && context.endpoint !== null,
    compress: true,
    ignoreSystemCrashHandler: true,
    globalExtra: { _version: context.version, channel: context.channel },
  };
}

/** A crash dump found on disk, as the settings list it. */
export interface CrashEntry {
  /** The dump's file name (its Crashpad id). */
  id: string;
  /** When it was written (ms since epoch). */
  date: number;
  sizeBytes: number;
  /** Which process crashed, when Crashpad's folder tells ("pending": not sent yet). */
  state: "pending" | "completed" | "other";
}

/** How many crashes the settings list (newest first). */
export const MAX_LISTED_CRASHES = 20;

/** Newest first, at most `MAX_LISTED_CRASHES`, without duplicate ids. */
export function sortCrashes(entries: readonly CrashEntry[]): CrashEntry[] {
  const seen = new Set<string>();
  return [...entries]
    .sort((a, b) => b.date - a.date)
    .filter((entry) => !seen.has(entry.id) && seen.add(entry.id))
    .slice(0, MAX_LISTED_CRASHES);
}

export function crashSizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

/** What the crash settings show and do. */
export interface CrashReportsInfo {
  /** The build's endpoint host, null without one (the toggle is then unavailable). */
  endpointHost: string | null;
  /** The reporter's current upload state (what Crashpad was told). */
  uploading: boolean;
  /** Reports the endpoint acknowledged (Crashpad's upload list). */
  uploadedCount: number;
  crashes: CrashEntry[];
}

// --- "Signaler un problème" ---------------------------------------------------------------------

export const ISSUE_BASE = "https://github.com/Mathieu-Lalande/browser/issues/new";

export interface IssueContext {
  version: string;
  /** `process.platform`. */
  platform: string;
  /** OS release (`os.release()`): a kernel/build number, nothing personal. */
  osVersion: string;
  arch: string;
  electron: string;
  channel: string;
}

const OS_NAMES: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };

/** "Windows 10.0.22631 (x64)": what the issue form's "Système" field is prefilled with. */
export function osText(context: Pick<IssueContext, "platform" | "osVersion" | "arch">): string {
  return `${OS_NAMES[context.platform] ?? context.platform} ${context.osVersion} (${context.arch})`.replace(/\s+/g, " ").trim();
}

/**
 * The bug form (`.github/ISSUE_TEMPLATE/bug.yml`) prefilled with the version and the system only:
 * no URL, no tab, no account. Field ids match the template's.
 */
export function issueUrl(context: IssueContext): string {
  const params = new URLSearchParams({
    template: "bug.yml",
    labels: "bug",
    version: `${context.version} (${context.channel}, Electron ${context.electron})`,
    os: osText(context),
  });
  return `${ISSUE_BASE}?${params.toString()}`;
}
