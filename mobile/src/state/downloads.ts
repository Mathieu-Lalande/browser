import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { addDownload, downloadFileName, parseDownloads, uniqueFileName, type DownloadRequest, type MobileDownload } from "../lib/downloads";
import { KEYS, loadDocument, persistDocument } from "../lib/storage";
import { Store } from "./store";

/**
 * The downloads of the phone (ADR-055): files in `<documents>/Downloads`, their list in
 * AsyncStorage (`browser.downloads`). A private tab's file goes to `<cache>/private-downloads`, is
 * never listed, and that folder is emptied when the private session ends and at start-up.
 */

const VERSION = 1;
export const downloads = new Store<MobileDownload[]>([]);

const folder = () => new Directory(Paths.document, "Downloads");
const privateFolder = () => new Directory(Paths.cache, "private-downloads");
const fileOf = (item: MobileDownload) => new File(folder(), item.name);

let loading: Promise<void> | null = null;

/** Loads the list once (entries whose file is gone are dropped) and keeps it saved. */
export function loadDownloads(): Promise<void> {
  loading ??= (async () => {
    clearPrivateDownloads();
    const stored = parseDownloads(await loadDocument(KEYS.downloads, VERSION));
    downloads.set(stored.filter((item) => safely(() => fileOf(item).exists, false)));
    persistDocument(downloads, (list) => list, KEYS.downloads, VERSION, () => downloads.get());
  })();
  return loading;
}

function safely<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch {
    return fallback;
  }
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Fetches `request` into the app's folder (the private cache for a private tab). Normal tabs get a
 * list entry; the file is returned either way so it can be offered at once.
 */
export async function downloadFile(request: DownloadRequest, options: { isPrivate: boolean; headers?: Record<string, string> }): Promise<{ file: File; name: string; item: MobileDownload | null }> {
  await loadDownloads();
  const directory = options.isPrivate ? privateFolder() : folder();
  directory.create({ idempotent: true, intermediates: true });
  const taken = new Set(safely(() => directory.list().map((entry) => entry.name), [] as string[]));
  const name = uniqueFileName(downloadFileName(request.url, request.contentDisposition, request.mimeType), taken);
  const target = new File(directory, name);
  const headers = Object.fromEntries(Object.entries(options.headers ?? {}).filter(([, value]) => value));
  const file = await File.downloadFileAsync(request.url, target, { headers, idempotent: true });
  if (options.isPrivate) return { file, name, item: null };
  const item: MobileDownload = { id: newId(), name, size: safely(() => file.size ?? 0, 0), mimeType: request.mimeType.split(";")[0]!.trim(), url: request.url, createdAt: Date.now() };
  const { list, dropped } = addDownload(downloads.get(), item);
  downloads.set(list);
  for (const old of dropped) safely(() => fileOf(old).delete(), undefined);
  return { file, name, item };
}

/** Opens a file in the system viewer (Quick Look on iOS, the default app on Android). */
export async function previewFile(file: File, mimeType: string): Promise<void> {
  await file.preview(mimeType ? { mimeType } : undefined);
}

export async function shareFile(file: File, mimeType: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) return;
  await Sharing.shareAsync(file.uri, mimeType ? { mimeType } : undefined);
}

export const openDownload = (item: MobileDownload) => previewFile(fileOf(item), item.mimeType);
export const shareDownload = (item: MobileDownload) => shareFile(fileOf(item), item.mimeType);

export function removeDownload(item: MobileDownload): void {
  safely(() => fileOf(item).delete(), undefined);
  downloads.set((list) => list.filter((entry) => entry.id !== item.id));
}

/** Empties the private downloads folder (end of the private session, start-up). */
export function clearPrivateDownloads(): void {
  safely(() => {
    const directory = privateFolder();
    if (directory.exists) directory.delete();
  }, undefined);
}
