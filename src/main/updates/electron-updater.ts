import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import type { UpdateEvent } from "@shared/updates";
import type { Updater } from "./service";

/**
 * electron-updater behind the small `Updater` interface (ADR-030). GitHub provider on the
 * project's releases; the service decides when to check and download, so automatic download is
 * off here. A downloaded update is also installed when the app quits (`autoInstallOnAppQuit`).
 */
export async function createElectronUpdater(): Promise<Updater> {
  // Loaded only in a packaged app: development and tests never import it.
  const { default: updaterModule } = await import("electron-updater");
  const updater = updaterModule.autoUpdater;
  updater.setFeedURL({ provider: "github", owner: "Mathieu-Lalande", repo: "browser", releaseType: "release" });
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.allowDowngrade = false;
  updater.logger = { info: () => {}, warn: (message: unknown) => console.warn("[updates]", message), error: (message: unknown) => console.warn("[updates]", message) } as typeof updater.logger;

  let listener: (event: UpdateEvent) => void = () => {};
  updater.on("checking-for-update", () => listener({ type: "checking" }));
  updater.on("update-available", (info) => listener({ type: "available", version: info.version }));
  updater.on("update-not-available", () => listener({ type: "not-available" }));
  updater.on("download-progress", (progress) => listener({ type: "progress", percent: progress.percent }));
  updater.on("update-downloaded", (info) => listener({ type: "downloaded", version: info.version }));
  // Failures reach the service through the rejected promises below (with a French message).

  return {
    configure({ allowPrerelease }) {
      updater.allowPrerelease = allowPrerelease;
    },
    async check() {
      await updater.checkForUpdates();
    },
    async download() {
      await updater.downloadUpdate();
    },
    install() {
      // Not silent (the Windows installer shows its progress), then relaunch.
      updater.quitAndInstall(false, true);
    },
    onEvent(next) {
      listener = next;
    },
  };
}

/** macOS: Squirrel.Mac only installs updates signed with a real (Developer ID) identity, not ad hoc. */
function macSigned(): Promise<boolean> {
  const bundle = join(dirname(process.execPath), "..", "..");
  return new Promise((resolve) => {
    execFile("codesign", ["-dv", "--verbose=2", bundle], { timeout: 5000 }, (error, stdout, stderr) => {
      const output = `${stdout}${stderr}`;
      resolve(!error && /Authority=Developer ID Application/.test(output) && !/Signature=adhoc/.test(output));
    });
  });
}

/**
 * Can this installation replace itself? Windows: installed by the NSIS installer (not the portable
 * zip); Linux: run from the AppImage (not the .deb); macOS: signed.
 */
export async function canSelfUpdate(): Promise<boolean> {
  if (process.platform === "win32") return existsSync(join(dirname(process.execPath), `Uninstall ${app.getName()}.exe`));
  if (process.platform === "linux") return Boolean(process.env.APPIMAGE);
  if (process.platform === "darwin") return macSigned();
  return false;
}
