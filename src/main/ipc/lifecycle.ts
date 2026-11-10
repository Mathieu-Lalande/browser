import { isBackupMode, MIN_PASSPHRASE } from "@shared/backup";
import { Channels } from "@shared/ipc";
import { isPrintOptions } from "@shared/print";
import { isProfileId, isProfileInput } from "@shared/profiles";
import { MAX_CLOSED_WINDOWS, type ClosedLists } from "@shared/recovery";
import { appServices } from "../app-services-ref";
import { arrayOf, bool, custom, defineHandlers, handle, intIn, maxStr, nullable, on, oneOf } from "./registry";

const index = intIn(0, 1000);
const pid = intIn(1, 2 ** 31);
/** A passphrase, or null (no passwords); long enough is checked by the service. */
const passphrase = nullable(custom<string>((value) => typeof value === "string" && value.length >= MIN_PASSPHRASE && value.length <= 1024));

/**
 * ADR-042: crash recovery and recently closed things, user profiles, the task manager, the print
 * preview and profile backups. What writes to the profile is refused to private windows.
 */
export const lifecycleHandlers = defineHandlers({
  [Channels.recoveryRestore]: handle(
    [nullable(arrayOf(intIn(0, MAX_CLOSED_WINDOWS * 100), 100))],
    (c, indexes) => appServices().recovery.restore(c, indexes),
    { privateRefused: true },
  ),
  [Channels.recoveryDismiss]: on([], () => appServices().recovery.dismiss(), { privateRefused: true }),
  [Channels.recoveryClosed]: handle([], (c): ClosedLists => ({
    tabs: c.tabs.closedTabs().map((tab, at) => ({ index: at, title: tab.title, url: tab.url })),
    // Closed windows are normal windows: a private window does not list them.
    windows: c.isPrivate ? [] : appServices().recovery.closedWindows(),
  })),
  [Channels.recoveryReopen]: on([oneOf("tab", "window"), index], (c, kind, at) => {
    if (kind === "tab") c.tabs.reopenClosed(at);
    else if (!c.isPrivate) appServices().recovery.reopenWindow(at);
  }),

  [Channels.profilesList]: handle([], () => appServices().profiles.view()),
  [Channels.profilesCreate]: handle([isProfileInput], (_c, input) => appServices().profiles.create(input), { privateRefused: true }),
  [Channels.profilesUpdate]: handle([isProfileId, isProfileInput], (_c, id, input) => appServices().profiles.edit(id, input), { privateRefused: true }),
  [Channels.profilesRemove]: handle([isProfileId], (_c, id) => appServices().profiles.remove(id), { privateRefused: true }),
  [Channels.profilesOpen]: handle([isProfileId], (_c, id) => appServices().profiles.open(id)),
  [Channels.profilesSetAsk]: handle([bool], (_c, ask) => appServices().profiles.setAskOnLaunch(ask), { privateRefused: true }),

  [Channels.tasksList]: handle([], () => appServices().tasks.list()),
  // ADR-043: crash dumps are app-wide (not profile data a private window could leak into).
  [Channels.crashesInfo]: handle([], () => appServices().crashes.info()),
  [Channels.crashesClear]: handle([], () => appServices().crashes.clear(), { privateRefused: true }),
  [Channels.tasksKill]: handle([pid], (_c, target) => appServices().tasks.kill(target)),
  [Channels.tasksSleepSavings]: handle([], () => appServices().tasks.sleepSavings()),

  [Channels.printUpdate]: handle([isPrintOptions], (c, options) => appServices().print.update(c, options)),
  [Channels.printPrinters]: handle([], (c) => appServices().print.printers(c)),
  [Channels.printRun]: handle([isPrintOptions], (c, options) => appServices().print.run(c, options)),
  [Channels.printClose]: on([], (c) => appServices().print.closeOverlay(c)),

  [Channels.backupExport]: handle([passphrase], (c, secret) => appServices().backup.export(c.window, secret), { privateRefused: true }),
  [Channels.backupInspect]: handle([], (c) => appServices().backup.inspect(c.window), { privateRefused: true }),
  [Channels.backupApply]: handle([isBackupMode, nullable(maxStr(1024))], (_c, mode, secret) => appServices().backup.apply(mode, secret), {
    privateRefused: true,
  }),
});
