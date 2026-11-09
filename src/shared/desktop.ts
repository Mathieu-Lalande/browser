import { t } from "./i18n";
import { isActiveDownload, overallProgress, type DownloadEntry } from "./downloads";

/**
 * OS integration (ADR-048), pure: what the Windows Jump List and the macOS Dock menu offer, the
 * command-line switches they launch the browser with (read back by `second-instance`), the
 * taskbar's downloads badge, and whether Mica applies. No Electron here: unit-tested.
 */

export const NEW_TAB_SWITCH = "--new-tab";
export const PRIVATE_SWITCH = "--private";
export const SPACE_SWITCH = "--space=";

/** What a launch asks besides links: a new tab, a private window, a space to show. */
export interface LaunchActions {
  newTab: boolean;
  private: boolean;
  spaceId: string | null;
}

const SPACE_ID = /^[\w-]{1,64}$/;

/** The actions of a command line, or null when it asks none (only links, or nothing). */
export function parseLaunchActions(argv: readonly string[]): LaunchActions | null {
  const actions: LaunchActions = { newTab: false, private: false, spaceId: null };
  for (const arg of argv.slice(1)) {
    if (arg === NEW_TAB_SWITCH) actions.newTab = true;
    else if (arg === PRIVATE_SWITCH) actions.private = true;
    else if (arg.startsWith(SPACE_SWITCH)) {
      const id = arg.slice(SPACE_SWITCH.length);
      if (SPACE_ID.test(id)) actions.spaceId = id;
    }
  }
  return actions.newTab || actions.private || actions.spaceId ? actions : null;
}

/** One entry of the Jump List / Dock menu. */
export interface DesktopTask {
  title: string;
  description: string;
  /** The switch the browser is launched with. */
  args: string;
}

export interface DesktopTasks {
  /** "Tâches": new tab, new private window. */
  tasks: DesktopTask[];
  /** "Espaces": one entry per space, which shows it. */
  spaces: DesktopTask[];
}

/** Spaces listed: the Jump List keeps a few entries visible. */
export const MAX_DESKTOP_SPACES = 8;

export function desktopTasks(spaces: readonly { id: string; name: string }[]): DesktopTasks {
  return {
    tasks: [
      { title: t("desktop.newTab"), description: t("desktop.opensNewTabLast"), args: NEW_TAB_SWITCH },
      { title: t("desktop.newPrivateWindow"), description: t("desktop.opensPrivateBrowsingWindow"), args: PRIVATE_SWITCH },
    ],
    spaces: spaces
      .filter((space) => SPACE_ID.test(space.id))
      .slice(0, MAX_DESKTOP_SPACES)
      .map((space) => ({ title: space.name, description: t("desktop.showsSpace", { name: space.name }), args: `${SPACE_SWITCH}${space.id}` })),
  };
}

/** Taskbar state of the downloads: the progress bar (null: none; "indeterminate": unknown sizes) and the badge's count. */
export interface TaskbarDownloads {
  progress: number | "indeterminate" | null;
  running: number;
}

export function taskbarDownloads(entries: readonly DownloadEntry[]): TaskbarDownloads {
  const running = entries.filter((entry) => entry.state === "progressing").length;
  if (!entries.some(isActiveDownload)) return { progress: null, running: 0 };
  return { progress: overallProgress(entries) ?? "indeterminate", running };
}

/** Windows 11 (build 22000) and later draw Mica behind a window (`backgroundMaterial`). */
export function micaSupported(platform: string, release: string): boolean {
  if (platform !== "win32") return false;
  const build = Number(release.split(".")[2]);
  return Number.isFinite(build) && build >= 22000;
}
