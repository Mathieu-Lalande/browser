import { extname, posix, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isPageOpenableUrl } from "@shared/url";

/**
 * What the OS hands the browser to open (ADR-039): links (`http`, `https`) once it is the default
 * browser, and local files of the associated types. They arrive on the command line (first launch,
 * `second-instance`) or through macOS events (`open-url`, `open-file`).
 */

/** Local files the browser is associated with (installer `fileAssociations`). */
export const LOCAL_FILE_EXTENSIONS: readonly string[] = [".html", ".htm", ".xhtml", ".pdf"];

/** More tabs than this from one launch are ignored (a shell glob gone wrong). */
export const MAX_LAUNCH_TARGETS = 20;

export interface LaunchContext {
  /** Working directory of the launching process (relative paths). */
  cwd: string;
  /** Platform whose path syntax is used by the launching process. */
  platform?: NodeJS.Platform;
  /** Whether a regular file exists at this absolute path. */
  isFile(path: string): boolean;
}

/** The `file://` URL of a local file the browser may open: an existing file of an associated type. */
export function localFileUrl(path: string, context: LaunchContext): string | null {
  const platform = context.platform ?? (context.cwd.startsWith("/") ? "linux" : process.platform);
  const pathApi = platform === "win32" ? win32 : posix;
  const absolute = pathApi.isAbsolute(path) ? path : pathApi.resolve(context.cwd, path);
  if (!LOCAL_FILE_EXTENSIONS.includes(extname(absolute).toLowerCase())) return null;
  if (!context.isFile(absolute)) return null;
  return platform === "win32" ? pathToFileURL(absolute).href : `file://${absolute.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * The URL to open for one thing handed over by the OS: a web page (`isPageOpenableUrl`, the same
 * rule as links opened by pages) or a local file of an associated type; null for anything else
 * (`javascript:`, `data:`, `browser://`, other schemes, folders, other files).
 */
export function launchUrl(input: string, context: LaunchContext): string | null {
  const value = input.trim();
  if (!value || value.length > 8192) return null;
  if (/^file:/i.test(value)) {
    try {
      const platform = context.platform ?? (context.cwd.startsWith("/") ? "linux" : process.platform);
      const path = platform === "win32" ? fileURLToPath(value) : decodeURIComponent(new URL(value).pathname);
      return localFileUrl(path, context);
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return isPageOpenableUrl(value) ? new URL(value).href : null;
  return localFileUrl(value, context);
}

/**
 * The URLs a command line asks to open. `argv[0]` (the executable) and switches (`--flag`) are
 * skipped, as is the app folder an unpackaged run is given (a folder is never opened).
 */
export function launchUrls(argv: readonly string[], context: LaunchContext): string[] {
  const urls: string[] = [];
  for (const arg of argv.slice(1)) {
    if (arg.startsWith("-")) continue;
    const url = launchUrl(arg, context);
    if (url && !urls.includes(url)) urls.push(url);
    if (urls.length >= MAX_LAUNCH_TARGETS) break;
  }
  return urls;
}

/** A window that can show what the OS handed over. */
export interface LaunchWindow {
  openUrl(url: string): void;
  focus(): void;
}

export interface LaunchWindows {
  /** The normal (not private) window the user used last, if one is open. */
  lastNormal(): LaunchWindow | undefined;
  /** Opens a new normal window. */
  create(): LaunchWindow;
}

/**
 * Delivers URLs from the OS to the last focused normal window (a new one when only private
 * windows are open: a link from another app never lands in a private window). URLs arriving
 * before the app is ready (macOS `open-url` at launch, the first command line) wait for `ready()`.
 */
export class LaunchRouter {
  private pending: string[] = [];
  private isReady = false;

  constructor(private readonly windows: () => LaunchWindows) {}

  open(urls: readonly string[]): void {
    if (!urls.length) return;
    if (!this.isReady) {
      this.pending.push(...urls);
      return;
    }
    const target = this.windows().lastNormal() ?? this.windows().create();
    for (const url of urls.slice(0, MAX_LAUNCH_TARGETS)) target.openUrl(url);
    target.focus();
  }

  /** The windows exist: delivers what arrived meanwhile. */
  ready(): void {
    this.isReady = true;
    const pending = this.pending;
    this.pending = [];
    this.open(pending);
  }
}
