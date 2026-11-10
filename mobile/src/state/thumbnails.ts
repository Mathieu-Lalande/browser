import { Directory, File, Paths } from "expo-file-system";
import type { ComponentRef, RefObject } from "react";
import { Platform, type View } from "react-native";
import { captureRef } from "react-native-view-shot";
import { FILE_THUMBNAILS, LruMap, MEMORY_THUMBNAILS, THUMBNAIL_QUALITY, THUMBNAIL_WIDTH, indexThumbnailFiles, thumbnailFileName } from "../lib/thumbnails";
import { Store } from "./store";

/**
 * Tab thumbnails (ADR-055): `thumbnails` maps a tab id to the image the overview card shows (a
 * `data:` URI while in the memory LRU, else the cached file). Callers never pass a private tab
 * (`canCaptureTab`); closed tabs are forgotten with `retainThumbnails`.
 */
export const thumbnails = new Store<Readonly<Record<string, string>>>({});

const memory = new LruMap<string>(MEMORY_THUMBNAILS);
const files = new LruMap<{ name: string; version: number }>(FILE_THUMBNAILS);
const folder = () => new Directory(Paths.cache, "thumbnails");
// The web preview has no file system nor native capture: cards keep their favicon there.
let loaded = Platform.OS === "web";

function quietly(run: () => void): void {
  try {
    run();
  } catch {
    // A cache file that cannot be read or deleted is simply not shown.
  }
}

function publish(): void {
  const next: Record<string, string> = {};
  const directory = folder();
  for (const tabId of files.keys()) {
    const entry = files.peek(tabId)!;
    next[tabId] = memory.peek(tabId) ?? new File(directory, entry.name).uri;
  }
  thumbnails.set(next);
}

/** Indexes the cache folder once (captures survive restarts). */
export function loadThumbnails(): void {
  if (loaded) return;
  loaded = true;
  quietly(() => {
    const directory = folder();
    if (!directory.exists) return;
    const listed = directory.list().filter((entry): entry is File => entry instanceof File);
    const { keep, remove } = indexThumbnailFiles(listed.map((file) => ({ name: file.name, modified: file.modificationTime ?? 0 })));
    for (const name of remove) quietly(() => new File(directory, name).delete());
    for (const entry of keep) for (const [, old] of files.set(entry.tabId, { name: entry.name, version: entry.version })) quietly(() => new File(directory, old.name).delete());
  });
  publish();
}

let capturing = false;

/** Captures `view` as the thumbnail of `tabId` (a normal tab showing a web page). */
export async function captureThumbnail(tabId: string, view: RefObject<ComponentRef<typeof View> | null>): Promise<void> {
  if (capturing || !view.current || Platform.OS === "web") return;
  capturing = true;
  try {
    loadThumbnails();
    const base64 = await captureRef(view, { format: "jpg", quality: THUMBNAIL_QUALITY, width: THUMBNAIL_WIDTH, result: "base64" });
    const directory = folder();
    directory.create({ idempotent: true, intermediates: true });
    const version = (files.peek(tabId)?.version ?? 0) + 1;
    const name = thumbnailFileName(tabId, version);
    await new File(directory, name).write(base64, { encoding: "base64" });
    const previous = files.peek(tabId);
    if (previous) quietly(() => new File(directory, previous.name).delete());
    for (const [, old] of files.set(tabId, { name, version })) quietly(() => new File(directory, old.name).delete());
    memory.set(tabId, `data:image/jpeg;base64,${base64}`);
    publish();
  } catch {
    // Nothing to capture (view gone, no surface yet): the card keeps its favicon.
  } finally {
    capturing = false;
  }
}

/** Forgets the thumbnails of tabs that no longer exist (closed, or a private session ended). */
export function retainThumbnails(tabIds: ReadonlySet<string>): void {
  // An empty model is the app still loading its session, never "every tab closed" (a new tab opens).
  if (tabIds.size === 0 || Platform.OS === "web") return;
  loadThumbnails();
  const removed = files.retain(tabIds);
  memory.retain(tabIds);
  if (!removed.length) return;
  const directory = folder();
  for (const [, entry] of removed) quietly(() => new File(directory, entry.name).delete());
  publish();
}
