import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { app, dialog, nativeImage, shell } from "electron";
import { t } from "@shared/i18n";
import { desktopEntry, icoFromPng, shortcutName, webAppArgs } from "@shared/web-apps";
import type { WindowPort } from "./ports";

/**
 * "Installer comme application" (ADR-059): writes the site's shortcuts, which launch the browser
 * with `--app=<url>` (read by `parseAppSwitch` → an app window, ADR-048's mini window). Windows:
 * Desktop and Start menu `.lnk` with the site's icon as `.ico`; Linux: a `.desktop` entry;
 * macOS has no shortcut file to write: the site just opens in its window (keep it in the Dock).
 */

const ICON_SIZE = 64;

/** `--profile=<id>` of this instance (ADR-042): an app of a profile opens in that profile. */
const profileArg = (): string | undefined => process.argv.find((arg) => arg.startsWith("--profile="))?.slice("--profile=".length);

function iconFiles(id: string, favicon: string | null): { ico: string | null; png: string | null } {
  if (!favicon?.startsWith("data:image/")) return { ico: null, png: null };
  const image = nativeImage.createFromDataURL(favicon);
  if (image.isEmpty()) return { ico: null, png: null };
  const png = image.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: "best" }).toPNG();
  const dir = join(app.getPath("userData"), "web-apps");
  mkdirSync(dir, { recursive: true });
  const pngPath = join(dir, `${id}.png`);
  const icoPath = join(dir, `${id}.ico`);
  writeFileSync(pngPath, png);
  writeFileSync(icoPath, icoFromPng(png, ICON_SIZE));
  return { ico: icoPath, png: pngPath };
}

/** Writes the shortcuts; returns where, or why not. */
function writeShortcuts(url: string, name: string, favicon: string | null): { ok: true; places: string[] } | { ok: false } {
  const args = webAppArgs(url, { appPath: app.isPackaged ? undefined : app.getAppPath(), profile: profileArg() });
  const id = name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "app";
  const icons = iconFiles(id, favicon);
  if (process.platform === "win32") {
    const places = [join(app.getPath("desktop"), `${name}.lnk`), join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", `${name}.lnk`)];
    const written = places.filter((path) =>
      shell.writeShortcutLink(path, "create", {
        target: process.execPath,
        args: args.map((arg) => (/[\s"]/u.test(arg) ? `"${arg}"` : arg)).join(" "),
        description: name,
        ...(icons.ico ? { icon: icons.ico, iconIndex: 0 } : {}),
      }),
    );
    return written.length ? { ok: true, places: written } : { ok: false };
  }
  if (process.platform === "linux") {
    const dir = join(homedir(), ".local", "share", "applications");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `browser-app-${id}.desktop`);
    writeFileSync(path, desktopEntry(name, process.execPath, args, icons.png), { mode: 0o755 });
    return { ok: true, places: [path] };
  }
  return { ok: false };
}

let opener: ((url: string) => void) | null = null;

/** Set at startup: how an app window is opened (the mini windows, ADR-048). */
export function setWebAppOpener(open: (url: string) => void): void {
  opener = open;
}

/** The command, for the active tab: shortcuts written, the site opened in its app window. */
export async function installWebApp(c: WindowPort, open: (url: string) => void = (url) => opener?.(url)): Promise<void> {
  if (c.isPrivate) return;
  const tab = c.tabs.getState().tabs.find((entry) => entry.id === c.tabs.activeTabId);
  if (!tab || !/^https?:/u.test(tab.url)) return;
  const name = shortcutName(tab.title, tab.url);
  const result = writeShortcuts(tab.url, name, tab.favicon);
  open(tab.url);
  if (process.platform === "darwin") return;
  if (c.window.isDestroyed()) return;
  await dialog.showMessageBox(c.window, {
    type: result.ok ? "info" : "warning",
    title: t("webApps.title"),
    message: result.ok ? t("webApps.installed", { name }) : t("webApps.failed"),
    detail: result.ok ? (process.platform === "win32" ? t("webApps.windowsDetail") : t("webApps.linuxDetail")) : undefined,
    buttons: [t("webApps.ok")],
    noLink: true,
  });
}
