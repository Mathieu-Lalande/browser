import type { BaseWindow, Session } from "electron";
import type { DownloadEntry, DownloadsChange } from "@shared/downloads";
import type { Settings } from "@shared/settings";
import { appServices } from "../services";
import type { DownloadViewer } from "./list";

/**
 * Downloads (ADR-013): function facades over the app's `DownloadService` (./service.ts), for the
 * IPC handlers and windows. The service is installed in each tab session by `SessionHardener`.
 */

const downloads = () => appServices().downloads;

export const downloadsFolder = (current?: Settings): string => downloads().folder(current);
export const onDownloadsChanged = (listener: (change: DownloadsChange) => void): (() => void) => downloads().onChanged(listener);
export const listDownloads = (viewer: DownloadViewer): DownloadEntry[] => downloads().list(viewer);
export const isDownloadVisible = (id: string, viewer: DownloadViewer): boolean => downloads().isVisible(id, viewer);
export const downloadViewerOf = (ses: Session | null): DownloadViewer => downloads().viewerOf(ses);
export const pauseDownload = (id: string): void => downloads().pause(id);
export const resumeDownload = (id: string): void => downloads().resume(id);
export const cancelDownload = (id: string): void => downloads().cancel(id);
export const keepDownload = (id: string, window?: BaseWindow): Promise<void> => downloads().keep(id, window);
export const openDownload = (id: string): void => downloads().open(id);
export const showDownloadInFolder = (id: string): void => downloads().showInFolder(id);
export const removeDownload = (id: string): void => downloads().remove(id);
export const retryDownload = (id: string, fallback: Session): void => downloads().retry(id, fallback);
export const clearDownloads = (viewer: DownloadViewer): void => downloads().clear(viewer);
export const chooseDownloadsFolder = (window?: BaseWindow): Promise<Settings> => downloads().chooseFolder(window);
