import { t } from "@shared/i18n";
import { readFileSync, statSync } from "node:fs";
import { app, dialog } from "electron";
import { Channels } from "@shared/ipc";
import { MAX_PASSWORD_CSV_BYTES } from "@shared/import/passwords-csv";
import { IMPORT_ITEMS, isImportId, isImportItem, type PasswordImportSummary } from "@shared/import/types";
import { appServices } from "../app-services-ref";
import type { BrowserController } from "../window";
import { arrayOf, defineHandlers, handle, handleUi } from "./registry";

/** Default browser (ADR-039): any window may ask, the OS has the last word. */
export const defaultBrowserHandlers = defineHandlers({
  [Channels.defaultBrowserStatus]: handleUi([], () => appServices().defaultBrowser.status()),
  [Channels.defaultBrowserSet]: handleUi([], () => appServices().defaultBrowser.makeDefault()),
});

/** Protected content (ADR-040): the Widevine CDM status, read-only. */
export const drmHandlers = defineHandlers({
  [Channels.drmStatus]: handleUi([], () => appServices().widevine.status()),
});

const NOTHING: Omit<PasswordImportSummary, "ok"> = { added: 0, updated: 0, skipped: 0, invalid: 0 };

/** The file is chosen in main's own dialog: the UI never names a path. */
async function importPasswordsCsv(c: BrowserController): Promise<PasswordImportSummary> {
  const { canceled, filePaths } = await dialog.showOpenDialog(c.window, {
    title: t("ipcImport.importPasswords"),
    defaultPath: app.getPath("downloads"),
    filters: [{ name: "CSV", extensions: ["csv"] }],
    properties: ["openFile"],
  });
  const [path] = filePaths;
  if (canceled || !path) return { ok: true, cancelled: true, ...NOTHING };
  let text: string;
  try {
    if (statSync(path).size > MAX_PASSWORD_CSV_BYTES) return { ok: false, message: t("ipcImport.fileTooLarge"), ...NOTHING };
    text = readFileSync(path, "utf8");
  } catch {
    return { ok: false, message: t("ipcImport.fileCouldntRead"), ...NOTHING };
  }
  return appServices().imports.importPasswordCsv(text);
}

/**
 * Import from other browsers (ADR-039): never from a private window (everything is written to the
 * profile). The UI names a profile listed by `sources` and what to import.
 */
export const importHandlers = defineHandlers({
  [Channels.importSources]: handle([], () => appServices().imports.sources(), { privateRefused: true }),
  [Channels.importRun]: handle(
    [isImportId, arrayOf(isImportItem, IMPORT_ITEMS.length)],
    (c, profileId, items) => appServices().imports.run(profileId, items, (progress) => c.send(Channels.importProgress, progress)),
    { privateRefused: true },
  ),
  [Channels.importPasswords]: handle([], (c) => importPasswordsCsv(c), { privateRefused: true }),
});
