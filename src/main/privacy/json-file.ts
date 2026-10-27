import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, open, rename } from "node:fs/promises";
import { dirname } from "node:path";

/** Parsed contents of a small JSON settings file, or undefined if it is missing or corrupt. */
export function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Write a file atomically (temp file + fsync + rename), so a crash never leaves it half-written
 * nor an empty file renamed over the previous one.
 */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  const file = await open(temp, "w");
  try {
    await file.writeFile(data);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temp, path);
}

/** Same as `writeFileAtomic`, synchronously (on quit), with its own temp file. */
function writeFileAtomicSync(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.sync.tmp`;
  try {
    const fd = openSync(temp, "w");
    try {
      writeFileSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/** Writers whose latest data is not on disk yet (see `flushJsonWriters`). */
const unsaved = new Set<JsonFileWriter>();

/** Writes every pending save now, synchronously: on quit, before the process goes away. */
export function flushJsonWriters(): void {
  for (const writer of [...unsaved]) writer.flushSync();
}

/** Serializes the saves of one JSON file: writes never interleave and the latest data wins. */
export class JsonFileWriter {
  private queue: Promise<void> = Promise.resolve();
  /** The latest data, until it is on disk. */
  private pending: string | null = null;

  constructor(private readonly path: string) {}

  save(data: unknown): Promise<void> {
    const json = JSON.stringify(data, null, 2);
    this.pending = json;
    unsaved.add(this);
    this.queue = this.queue
      .then(() => this.write(json))
      .catch((error: unknown) => console.warn(`[privacy] could not save ${this.path}:`, error));
    return this.queue;
  }

  /** Writes the pending data now (on quit); the queued asynchronous writes then have nothing left to do. */
  flushSync(): void {
    const json = this.pending;
    if (json === null) return;
    this.done();
    try {
      writeFileAtomicSync(this.path, json);
    } catch (error) {
      console.warn(`[privacy] could not save ${this.path}:`, error);
    }
  }

  private async write(json: string): Promise<void> {
    // Superseded by a newer save (queued after this one), or already written by `flushSync`.
    if (json !== this.pending) return;
    await writeFileAtomic(this.path, json);
    if (json === this.pending) this.done();
  }

  private done(): void {
    this.pending = null;
    unsaved.delete(this);
  }
}
