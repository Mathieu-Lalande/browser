import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, dialog, ipcMain } from "electron";
import { Channels } from "@shared/ipc";
import { MAX_THEME_FILE, parseThemeFile, themeFile, themeFileName, validateTheme, type ThemeDecodeResult } from "@shared/theme-share";
import { BrowserController } from "./window";

/**
 * `.browsertheme` files (ADR-030): main shows the native dialogs and does the file I/O; the theme
 * is validated on the way out (it comes from the renderer) and on the way in (it comes from disk).
 * Applying an imported theme is an ordinary settings update, after the user's "Appliquer".
 */

const FILTERS = [{ name: "Thème Browser", extensions: ["browsertheme", "json"] }];

async function exportTheme(c: BrowserController, input: unknown): Promise<boolean> {
  const checked = validateTheme(input);
  if (!checked.ok) return false;
  const { canceled, filePath } = await dialog.showSaveDialog(c.window, {
    title: "Exporter le thème",
    defaultPath: join(app.getPath("documents"), themeFileName(checked.theme)),
    filters: FILTERS,
  });
  if (canceled || !filePath) return false;
  try {
    await writeFile(filePath, themeFile(checked.theme), "utf8");
    return true;
  } catch {
    return false;
  }
}

async function importTheme(c: BrowserController): Promise<ThemeDecodeResult | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog(c.window, { title: "Importer un thème", filters: FILTERS, properties: ["openFile"] });
  if (canceled || !filePaths[0]) return null;
  try {
    // Checked before reading: a huge file is refused without loading it.
    if ((await stat(filePaths[0])).size > MAX_THEME_FILE * 4) return { ok: false, error: "Fichier de thème trop volumineux." };
    return parseThemeFile(await readFile(filePaths[0], "utf8"));
  } catch {
    return { ok: false, error: "Le fichier n'a pas pu être lu." };
  }
}

export function registerThemeIpc(): void {
  ipcMain.handle(Channels.themeExportFile, (event, theme: unknown) => {
    const controller = BrowserController.fromUi(event.sender);
    if (!controller) throw new Error(`Rejected ${Channels.themeExportFile}`);
    return exportTheme(controller, theme);
  });
  ipcMain.handle(Channels.themeImportFile, (event) => {
    const controller = BrowserController.fromUi(event.sender);
    if (!controller) throw new Error(`Rejected ${Channels.themeImportFile}`);
    return importTheme(controller);
  });
}
