import { Channels } from "@shared/ipc";
import {
  cancelDownload,
  chooseDownloadsFolder,
  clearDownloads,
  isDownloadVisible,
  keepDownload,
  listDownloads,
  openDownload,
  pauseDownload,
  removeDownload,
  resumeDownload,
  retryDownload,
  showDownloadInFolder,
} from "../downloads";
import type { BrowserController } from "../window";
import { bounds, defineHandlers, handle, maxStr, on, type Entry } from "./registry";

/** A window only acts on the downloads it may see (a private window's stay its own). */
const onDownload = (action: (downloadId: string, c: BrowserController) => void): Entry =>
  on([maxStr(64)], (c, downloadId) => {
    if (isDownloadVisible(downloadId, c.downloadViewer)) action(downloadId, c);
  });

/** Downloads: the UI only names downloads by id; paths never come from the renderer. */
export const downloadHandlers = defineHandlers({
  [Channels.downloadsList]: handle([], (c) => listDownloads(c.downloadViewer)),
  [Channels.downloadsPause]: onDownload(pauseDownload),
  [Channels.downloadsResume]: onDownload(resumeDownload),
  [Channels.downloadsCancel]: onDownload(cancelDownload),
  [Channels.downloadsKeep]: onDownload((downloadId, c) => void keepDownload(downloadId, c.window)),
  [Channels.downloadsOpen]: onDownload(openDownload),
  [Channels.downloadsShowInFolder]: onDownload(showDownloadInFolder),
  [Channels.downloadsRemove]: onDownload(removeDownload),
  [Channels.downloadsRetry]: onDownload((downloadId, c) => retryDownload(downloadId, c.tabSession)),
  [Channels.downloadsClear]: on([], (c) => clearDownloads(c.downloadViewer)),
  [Channels.downloadsChooseFolder]: handle([], (c) => chooseDownloadsFolder(c.window)),
  [Channels.downloadsShowPanel]: on([bounds], (c, anchor) => c.overlay.open({ kind: "downloads", anchor })),
  [Channels.downloadsOpenPage]: on([], (c) => c.openDownloads()),
});
