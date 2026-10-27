import * as nodeFs from "node:fs";
import { dirname } from "node:path";

/** The few synchronous fs calls the store needs; injectable so tests can simulate failures. */
export type FileSystem = Pick<
  typeof nodeFs,
  "readFileSync" | "writeFileSync" | "renameSync" | "mkdirSync" | "openSync" | "fsyncSync" | "closeSync" | "rmSync"
>;

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

/**
 * One JSON document on disk (`{ version, data }`), written atomically: the content goes to a
 * temporary file that is fsync'd then renamed over the target, so a crash leaves either the
 * old or the new file, never a truncated one.
 */
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
    const temp = `${this.path}.tmp-${process.pid}`;
    try {
      // Inside the try: data that cannot be serialized (BigInt, cycles) is reported, not thrown.
      const content = JSON.stringify({ version: this.options.version, data } satisfies Envelope);
      if (content === this.lastWritten) return true;
      this.fs.mkdirSync(dirname(this.path), { recursive: true });
      this.fs.writeFileSync(temp, content, "utf8");
      const fd = this.fs.openSync(temp, "r+");
      try {
        this.fs.fsyncSync(fd);
      } finally {
        this.fs.closeSync(fd);
      }
      this.fs.renameSync(temp, this.path);
      this.lastWritten = content;
      return true;
    } catch (error) {
      this.report(error);
      try {
        this.fs.rmSync(temp, { force: true });
      } catch {
        // Nothing more to do: the previous file is still intact.
      }
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
