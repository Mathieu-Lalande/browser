import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Parsed contents of a small JSON settings file, or undefined if it is missing or corrupt. */
export function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** Write a file atomically (temp file + rename), so a crash never leaves it half-written. */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, data);
  await rename(temp, path);
}

/** Serializes the saves of one JSON file: writes never interleave and the latest data wins. */
export class JsonFileWriter {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  save(data: unknown): Promise<void> {
    const json = JSON.stringify(data, null, 2);
    this.queue = this.queue
      .then(() => writeFileAtomic(this.path, json))
      .catch((error: unknown) => console.warn(`[privacy] could not save ${this.path}:`, error));
    return this.queue;
  }
}
