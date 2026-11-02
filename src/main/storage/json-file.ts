import * as nodeFs from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

/** The few synchronous fs calls the store needs; injectable so tests can simulate failures. */
export type FileSystem = Pick<
  typeof nodeFs,
  "readFileSync" | "writeFileSync" | "renameSync" | "mkdirSync" | "openSync" | "fsyncSync" | "closeSync" | "rmSync"
>;

/*
 * Atomic writes, the one strategy of every file the browser keeps: the content goes to a
 * temporary file next to the target, is fsync'd, then renamed over it. A crash leaves either the
 * old or the new file, never a truncated one nor an empty file renamed over the previous one.
 */

const tempPath = (path: string, tag: string) => `${path}.${process.pid}.${tag}.tmp`;

/** Writes `data` to `path` atomically, synchronously (stores, and every save on quit). */
export function writeFileAtomicSync(path: string, data: string | Uint8Array, fs: FileSystem = nodeFs): void {
  const temp = tempPath(path, "sync");
  fs.mkdirSync(dirname(path), { recursive: true });
  try {
    const fd = fs.openSync(temp, "w");
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, path);
  } catch (error) {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // Nothing more to do: the previous file is still intact.
    }
    throw error;
  }
}

/** Same as `writeFileAtomicSync` without blocking the main process (large files: filter lists). */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = tempPath(path, "async");
  try {
    const file = await open(temp, "w");
    try {
      await file.writeFile(data);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export interface JsonFileOptions<T> {
  path: string;
  /** Current schema version, written next to the data. */
  version: number;
  /**
   * Validates (and migrates, from older `version`s) the stored data.
   * Returning null marks the file as corrupt.
   */
  parse(data: unknown, version: number): T | null;
  /** Delay used by `scheduleSave` to coalesce bursts of changes. */
  debounceMs?: number;
  fs?: FileSystem;
  now?: () => number;
  onError?: (error: unknown) => void;
}

interface Envelope {
  version: number;
  data: unknown;
}

function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== "object" || value === null) return false;
  const version = (value as Record<string, unknown>).version;
  return Number.isInteger(version) && (version as number) >= 1 && "data" in value;
}

/** One JSON document on disk (`{ version, data }`), versioned and written atomically. */
export class JsonFile<T> {
  private readonly fs: FileSystem;
  private readonly now: () => number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: (() => T) | null = null;
  private lastWritten: string | null = null;

  constructor(private readonly options: JsonFileOptions<T>) {
    this.fs = options.fs ?? nodeFs;
    this.now = options.now ?? Date.now;
  }

  get path(): string {
    return this.options.path;
  }

  /**
   * Reads the file. Returns null when it does not exist, or when it is unreadable — the
   * corrupt file is then kept aside as `<path>.corrupt-<timestamp>` so nothing is lost.
   */
  load(): T | null {
    let raw: string;
    try {
      raw = this.fs.readFileSync(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.report(error);
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      // A newer version means a newer app wrote it: treat it as unreadable rather than guess.
      if (isEnvelope(parsed) && parsed.version <= this.options.version) {
        const data = this.options.parse(parsed.data, parsed.version);
        if (data !== null) {
          this.lastWritten = raw;
          return data;
        }
      }
    } catch {
      // Invalid JSON: handled as corrupt below.
    }
    this.backupCorrupt();
    return null;
  }

  /** Saves after `debounceMs` of quiet; `snapshot` is evaluated at write time. */
  scheduleSave(snapshot: () => T): void {
    this.pending = snapshot;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.options.debounceMs ?? 1000);
    // A pending save must not keep a quitting process alive (flush() runs on quit anyway).
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** Writes a pending scheduled save right away (used on quit). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const snapshot = this.pending;
    this.pending = null;
    if (!snapshot) return;
    let data: T;
    try {
      data = snapshot();
    } catch (error) {
      // A broken snapshot must not stop the caller (on quit, the other stores still flush).
      return this.report(error);
    }
    this.save(data);
  }

  /** Cancels any pending save and writes `data` now. Returns false if the write failed. */
  save(data: T): boolean {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    try {
      // Inside the try: data that cannot be serialized (BigInt, cycles) is reported, not thrown.
      const content = JSON.stringify({ version: this.options.version, data } satisfies Envelope);
      if (content === this.lastWritten) return true;
      writeFileAtomicSync(this.path, content, this.fs);
      this.lastWritten = content;
      return true;
    } catch (error) {
      this.report(error);
      return false;
    }
  }

  private backupCorrupt(): void {
    const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, "-");
    try {
      this.fs.renameSync(this.path, `${this.path}.corrupt-${stamp}`);
    } catch (error) {
      this.report(error);
    }
  }

  private report(error: unknown): void {
    if (this.options.onError) this.options.onError(error);
    else console.error(`[storage] ${this.path}:`, error);
  }
}

/**
 * Flushes several stores, each in its own try: one failing store (full disk, broken snapshot)
 * never keeps the others from being written, on quit in particular.
 */
export function flushAll(
  files: readonly { flush(): void }[],
  onError: (error: unknown) => void = (error) => console.error("[storage]", error),
): void {
  for (const file of files) {
    try {
      file.flush();
    } catch (error) {
      onError(error);
    }
  }
}

/** Parsed contents of a small raw JSON file (no envelope), or undefined if it is missing or corrupt. */
export function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(nodeFs.readFileSync(path, "utf8"));
  } catch {
    return undefined;
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
