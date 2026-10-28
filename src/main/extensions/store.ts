import { isExtensionId, type ExtensionInfo } from "@shared/extensions";

/** `extensions.json` (ADR-024): the installed extensions and their switches. */
export const EXTENSIONS_VERSION = 1;

export interface ExtensionRecord {
  id: string;
  /** Absolute folder holding manifest.json: the user's own folder, or one under `<profile>/extensions/`. */
  path: string;
  /** Unpacked by the browser (its folder is deleted with the extension). */
  managed: boolean;
  enabled: boolean;
  allowPrivate: boolean;
  name: string;
  version: string;
  description: string;
  manifestVersion: 2 | 3;
  icon: string | null;
}

const MAX_EXTENSIONS = 100;
const MAX_ICON_LENGTH = 96 * 1024;

const isString = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;

function parseRecord(value: unknown): ExtensionRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  if (!isExtensionId(r.id) || !isString(r.path, 4096) || !r.path || !isString(r.name, 200) || !r.name || !isString(r.version, 64)) return null;
  if (r.manifestVersion !== 2 && r.manifestVersion !== 3) return null;
  const icon = isString(r.icon, MAX_ICON_LENGTH) && r.icon.startsWith("data:image/") ? r.icon : null;
  return {
    id: r.id,
    path: r.path,
    managed: r.managed === true,
    enabled: r.enabled !== false,
    allowPrivate: r.allowPrivate === true,
    name: r.name,
    version: r.version,
    description: isString(r.description, 1000) ? r.description : "",
    manifestVersion: r.manifestVersion,
    icon,
  };
}

/** In-memory list of installed extensions; persistence is the caller's (one JSON file). */
export class ExtensionStore {
  private records: ExtensionRecord[];

  constructor(records: readonly ExtensionRecord[] = []) {
    this.records = records.map((record) => ({ ...record }));
  }

  /** Validates stored data: bad entries are dropped, duplicates (id or path) keep the first. */
  static parse(data: unknown): ExtensionRecord[] | null {
    if (!Array.isArray(data)) return null;
    const records: ExtensionRecord[] = [];
    for (const value of data.slice(0, MAX_EXTENSIONS)) {
      const record = parseRecord(value);
      if (record && !records.some((known) => known.id === record.id || known.path === record.path)) records.push(record);
    }
    return records;
  }

  list(): readonly ExtensionRecord[] {
    return this.records;
  }

  get(id: string): ExtensionRecord | undefined {
    return this.records.find((record) => record.id === id);
  }

  byPath(path: string): ExtensionRecord | undefined {
    return this.records.find((record) => record.path === path);
  }

  get full(): boolean {
    return this.records.length >= MAX_EXTENSIONS;
  }

  add(record: ExtensionRecord): void {
    if (this.get(record.id) || this.byPath(record.path) || this.full) throw new Error("Extension already installed");
    this.records = [...this.records, { ...record }];
  }

  /** Changes switches of an installed extension; false when unknown or unchanged. */
  update(id: string, patch: Partial<Pick<ExtensionRecord, "enabled" | "allowPrivate">>): boolean {
    const record = this.get(id);
    if (!record) return false;
    const next = { ...record, ...patch };
    if (next.enabled === record.enabled && next.allowPrivate === record.allowPrivate) return false;
    this.records = this.records.map((known) => (known.id === id ? next : known));
    return true;
  }

  remove(id: string): ExtensionRecord | undefined {
    const record = this.get(id);
    if (record) this.records = this.records.filter((known) => known.id !== id);
    return record;
  }

  toJSON(): ExtensionRecord[] {
    return this.records.map((record) => ({ ...record }));
  }
}

/** What the UI sees (no filesystem path). */
export function toInfo(record: ExtensionRecord, error?: string): ExtensionInfo {
  const { id, name, version, description, manifestVersion, icon, enabled, allowPrivate, managed } = record;
  return { id, name, version, description, manifestVersion, icon, enabled, allowPrivate, managed, ...(error ? { error } : {}) };
}
