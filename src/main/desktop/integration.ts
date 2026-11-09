import { t } from "@shared/i18n";
import { app, Menu, nativeImage, type BrowserWindow, type NativeImage } from "electron";
import { desktopTasks, parseLaunchActions, taskbarDownloads, type DesktopTask, type LaunchActions } from "@shared/desktop";
import type { DownloadEntry } from "@shared/downloads";
import { GLYPH_SIZE, drawGlyph, type GlyphName } from "./glyphs";

/** A browser window as the taskbar sees it (a `BrowserController`). */
export interface DesktopWindow {
  readonly window: BrowserWindow;
  readonly isPrivate: boolean;
  back(): void;
  forward(): void;
  newTab(): void;
}

export interface DesktopDeps {
  platform: NodeJS.Platform;
  /** The executable and the arguments every task starts with (the app folder of an unpackaged run). */
  program: string;
  programArgs: readonly string[];
  spaces(): readonly { id: string; name: string }[];
  /** The normal windows' downloads (a private window's are never shown on the taskbar). */
  downloads(): readonly DownloadEntry[];
  windows(): readonly DesktopWindow[];
  /** Runs what a Dock menu item asks (macOS: no command line). */
  run(actions: LaunchActions): void;
}

/** Windows' accent-neutral badge behind the downloads arrow. */
const BADGE: readonly [number, number, number] = [37, 99, 235];

const glyph = (name: GlyphName, badge?: readonly [number, number, number]): NativeImage =>
  nativeImage.createFromBitmap(drawGlyph(name, [255, 255, 255], badge), { width: GLYPH_SIZE, height: GLYPH_SIZE });

/**
 * Integration with the OS shell (ADR-048). Windows: Jump List (tasks, spaces, recent files),
 * downloads on the taskbar button (progress bar and badge), thumbnail toolbar (back, forward,
 * new tab). macOS: the Dock menu offers the same tasks. Everything else is a no-op.
 */
export class DesktopIntegration {
  private icons: Partial<Record<GlyphName | "badge", NativeImage>> = {};

  constructor(private readonly deps: DesktopDeps) {}

  private get isWindows(): boolean {
    return this.deps.platform === "win32";
  }

  /** Jump List / Dock menu, again when the spaces change. */
  updateTasks(): void {
    const { tasks, spaces } = desktopTasks(this.deps.spaces());
    if (this.isWindows) this.updateJumpList(tasks, spaces);
    else if (this.deps.platform === "darwin") this.updateDockMenu(tasks, spaces);
  }

  /** A window just showed: its thumbnail toolbar, and the downloads state. */
  attach(target: DesktopWindow): void {
    if (!this.isWindows || target.window.isDestroyed()) return;
    target.window.setThumbarButtons([
      { tooltip: t("desktopIntegration.previous"), icon: this.icon("back"), click: () => target.back() },
      { tooltip: t("desktopIntegration.next"), icon: this.icon("forward"), click: () => target.forward() },
      { tooltip: t("desktopIntegration.newTab"), icon: this.icon("new-tab"), click: () => target.newTab() },
    ]);
    this.showDownloads([target]);
  }

  /** Downloads progressed, started or ended: every normal window's taskbar button follows. */
  downloadsChanged(): void {
    if (this.isWindows) this.showDownloads(this.deps.windows());
  }

  private showDownloads(windows: readonly DesktopWindow[]): void {
    const { progress, running } = taskbarDownloads(this.deps.downloads());
    for (const target of windows) {
      if (target.isPrivate || target.window.isDestroyed()) continue;
      if (progress === null) target.window.setProgressBar(-1);
      else if (progress === "indeterminate") target.window.setProgressBar(2, { mode: "indeterminate" });
      else target.window.setProgressBar(progress);
      const label = running === 1 ? t("desktopIntegration.n1DownloadProgress") : t("desktopIntegration.downloadsProgress", { running });
      target.window.setOverlayIcon(running > 0 ? this.icon("badge") : null, running > 0 ? label : "");
    }
  }

  private icon(name: GlyphName | "badge"): NativeImage {
    return (this.icons[name] ??= name === "badge" ? glyph("download", BADGE) : glyph(name));
  }

  private updateJumpList(tasks: DesktopTask[], spaces: DesktopTask[]): void {
    const item = (task: DesktopTask): Electron.JumpListItem => ({
      type: "task",
      title: task.title,
      description: task.description,
      program: this.deps.program,
      args: [...this.deps.programArgs, task.args].map(quoteArg).join(" "),
      iconPath: this.deps.program,
      iconIndex: 0,
    });
    const categories: Electron.JumpListCategory[] = [{ type: "tasks", items: tasks.map(item) }];
    if (spaces.length) categories.push({ type: "custom", name: t("desktopIntegration.spaces"), items: spaces.map(item) });
    // Files the browser opened (it is registered for .html and .pdf, ADR-039).
    categories.push({ type: "recent" });
    try {
      if (app.setJumpList(categories) === "ok") return;
      // Recent files refused (no file association in this build): tasks and spaces only.
      if (app.setJumpList(categories.filter((category) => category.type !== "recent")) === "ok") return;
    } catch {
      // Falls back to the plain tasks below.
    }
    app.setUserTasks(tasks.map(item) as Electron.Task[]);
  }

  private updateDockMenu(tasks: DesktopTask[], spaces: DesktopTask[]): void {
    const entry = (task: DesktopTask): Electron.MenuItemConstructorOptions => ({
      label: task.title,
      click: () => {
        const actions = parseLaunchActions(["dock", task.args]);
        if (actions) this.deps.run(actions);
      },
    });
    const template = [...tasks.map(entry), ...(spaces.length ? [{ type: "separator" as const }, ...spaces.map(entry)] : [])];
    app.dock?.setMenu(Menu.buildFromTemplate(template));
  }
}

/** One command-line argument, quoted for Windows when it holds spaces. */
function quoteArg(arg: string): string {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}
