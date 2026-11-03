import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Reads another browser's SQLite database (Chromium `History`, Firefox `places.sqlite`) with
 * Node's built-in `node:sqlite` (Electron 44 ships Node 24): no native module to build.
 *
 * The file is copied first, with its write-ahead log: the other browser may be running and hold a
 * lock on it, and opening it in place could replay its journal. Only the copy is opened (writable:
 * SQLite needs to rebuild a missing WAL index), and deleted afterwards.
 */
export function withSqliteCopy<T>(file: string, read: (db: DatabaseSync) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "browser-import-"));
  try {
    const copy = join(dir, basename(file));
    copyFileSync(file, copy);
    for (const suffix of ["-wal", "-shm"]) if (existsSync(file + suffix)) copyFileSync(file + suffix, copy + suffix);
    const db = new DatabaseSync(copy);
    try {
      return read(db);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
