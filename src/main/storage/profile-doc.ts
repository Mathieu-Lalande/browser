import { join } from "node:path";
import { app } from "electron";
import { Emitter } from "@shared/emitter";
import { JsonFile, flushAll } from "./json-file";

/**
 * A small JSON document of the profile (ADR-059: saved sessions, time per site, web apps): read
 * once on first use, written debounced and atomically, flushed when the app quits. The profile
 * folder is `userData` (each profile instance has its own, ADR-042).
 */
export class ProfileDoc<T> {
  private file: JsonFile<T> | null = null;
  private value: T | null = null;
  private readonly changes = new Emitter<void>();

  constructor(
    private readonly name: string,
    private readonly version: number,
    private readonly parse: (data: unknown) => T,
    private readonly empty: () => T,
  ) {
    docs.add(this);
  }

  get(): T {
    if (this.value === null) {
      this.file = new JsonFile<T>({ path: join(app.getPath("userData"), this.name), version: this.version, parse: this.parse, debounceMs: 800 });
      this.value = this.file.load() ?? this.empty();
    }
    return this.value;
  }

  set(next: T): void {
    this.get();
    this.value = next;
    this.file?.scheduleSave(() => this.value as T);
    this.changes.emit();
  }

  onChanged(listener: () => void): () => void {
    return this.changes.on(listener);
  }

  flush(): void {
    if (this.file) flushAll([this.file]);
  }
}

const docs = new Set<ProfileDoc<unknown>>();

/** Writes every pending document (on quit, with the rest of the profile). */
export function flushProfileDocs(): void {
  for (const doc of docs) doc.flush();
}
