import { isExtensionId, type ExtensionAction, type ExtensionInfo } from "@shared/extensions";
import { maxStr } from "../ipc/validators";

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
  /** Shown in the sidebar's extension row (ADR-049; default on). */
  pinned: boolean;
  /** Installed from the Chrome Web Store (ADR-049): updated from there. */
  webStoreId?: string;
}

/** What an installed extension's manifest says beyond the record (read again at each launch). */
export interface ExtensionDetails {
  action: ExtensionAction | null;
  permissions: string[];
}

const NO_DETAILS: ExtensionDetails = { action: null, permissions: [] };

const MAX_EXTENSIONS = 100;
const MAX_ICON_LENGTH = 96 * 1024;


function parseRecord(value: unknown): ExtensionRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  if (!isExtensionId(r.id) || !maxStr(4096)(r.path) || !r.path || !maxStr(200)(r.name) || !r.name || !maxStr(64)(r.version)) return null;
  if (r.manifestVersion !== 2 && r.manifestVersion !== 3) return null;
  const icon = maxStr(MAX_ICON_LENGTH)(r.icon) && r.icon.startsWith("data:image/") ? r.icon : null;
  return {
    id: r.id,
    path: r.path,
    managed: r.managed === true,
    enabled: r.enabled !== false,
    allowPrivate: r.allowPrivate === true,
    name: r.name,
    version: r.version,
    description: maxStr(1000)(r.description) ? r.description : "",
    manifestVersion: r.manifestVersion,
    icon,
    pinned: r.pinned !== false,
    ...(isExtensionId(r.webStoreId) ? { webStoreId: r.webStoreId } : {}),
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
  update(id: string, patch: Partial<Pick<ExtensionRecord, "enabled" | "allowPrivate" | "pinned">>): boolean {
    const record = this.get(id);
    if (!record) return false;
    const next = { ...record, ...patch };
    if (next.enabled === record.enabled && next.allowPrivate === record.allowPrivate && next.pinned === record.pinned) return false;
    this.records = this.records.map((known) => (known.id === id ? next : known));
    return true;
  }

  /** An updated extension (ADR-049): same id, new folder, version and manifest details. */
  replace(record: ExtensionRecord): void {
    if (!this.get(record.id)) throw new Error("Unknown extension");
    this.records = this.records.map((known) => (known.id === record.id ? { ...record } : known));
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

/** What the UI sees (no filesystem path). `details`: the toolbar button and permission warnings read from the manifest. */
export function toInfo(record: ExtensionRecord, details: ExtensionDetails = NO_DETAILS, error?: string): ExtensionInfo {
  const { id, name, version, description, manifestVersion, icon, enabled, allowPrivate, managed, pinned, webStoreId } = record;
  return {
    id,
    name,
    version,
    description,
    manifestVersion,
    icon,
    enabled,
    allowPrivate,
    managed,
    pinned,
    action: details.action,
    permissions: details.permissions,
    ...(webStoreId ? { webStoreId } : {}),
    ...(error ? { error } : {}),
  };
}
