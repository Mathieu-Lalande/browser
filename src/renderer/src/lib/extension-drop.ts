import { MAX_DROPPED_FILES, MAX_DROPPED_SIZE, type DroppedExtension } from "@shared/extensions";

/**
 * What was dropped on `browser://extensions` (ADR-049), read here and sent to main as bytes: a
 * .crx/.zip file, or a folder's files (relative paths). Never a path of the computer. A string:
 * why it cannot be installed (French).
 */
export async function readDrop(transfer: DataTransfer): Promise<DroppedExtension | string> {
  const entries = [...transfer.items].map((item) => item.webkitGetAsEntry()).filter((entry): entry is FileSystemEntry => !!entry);
  if (entries.length !== 1) return "Déposez une seule extension à la fois.";
  const [entry] = entries;
  if (entry.isDirectory) return readFolder(entry as FileSystemDirectoryEntry);
  const file = transfer.files[0];
  if (!file || !/\.(crx|zip)$/i.test(file.name)) return "Déposez un fichier .crx ou .zip, ou le dossier d'une extension.";
  if (file.size > MAX_DROPPED_SIZE) return "Ce fichier est trop volumineux pour une extension.";
  return { kind: "file", name: file.name, data: new Uint8Array(await file.arrayBuffer()) };
}

const fileOf = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));

/** Every entry of a directory (`readEntries` answers in batches). */
async function children(directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = directory.createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return all;
    all.push(...batch);
  }
}

async function readFolder(root: FileSystemDirectoryEntry): Promise<DroppedExtension | string> {
  const files: { path: string; data: Uint8Array }[] = [];
  let total = 0;
  const walk = async (directory: FileSystemDirectoryEntry, prefix: string): Promise<string | null> => {
    for (const entry of await children(directory)) {
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory) {
        const problem = await walk(entry as FileSystemDirectoryEntry, `${path}/`);
        if (problem) return problem;
        continue;
      }
      const file = await fileOf(entry as FileSystemFileEntry);
      total += file.size;
      if (files.length >= MAX_DROPPED_FILES || total > MAX_DROPPED_SIZE) return "Ce dossier est trop volumineux pour une extension.";
      files.push({ path, data: new Uint8Array(await file.arrayBuffer()) });
    }
    return null;
  };
  const problem = await walk(root, "");
  return problem ?? { kind: "folder", files };
}
