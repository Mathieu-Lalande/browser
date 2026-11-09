import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Versioned JSON documents in AsyncStorage (`{ version, data }`, like the desktop's JSON files,
 * ADR-005). Writes are debounced per key and flushed when the app goes to the background.
 */

export const KEYS = {
  session: "browser.session",
  history: "browser.history",
  bookmarks: "browser.bookmarks",
  settings: "browser.settings",
  mobile: "browser.mobile-settings",
  /** Bookmark folders received from the desktop through sync (not shown on the phone). */
  folders: "browser.bookmark-folders",
  /** The favorites grid (ADR-022, synced). */
  favorites: "browser.favorites",
  /** Archived tabs (ADR-022). */
  archive: "browser.archive",
  /** Boosts (ADR-029, synced). */
  boosts: "browser.boosts",
  /** Highlights and page notes (ADR-037, synced when opted in). */
  annotations: "browser.annotations",
  /** "Lire plus tard" with the offline texts (ADR-047, synced). */
  reading: "browser.reading-list",
} as const;

export type StorageKey = (typeof KEYS)[keyof typeof KEYS];

export async function loadDocument(key: StorageKey, version: number): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || !("version" in parsed) || !("data" in parsed)) return null;
    const { version: stored, data } = parsed as { version: unknown; data: unknown };
    // A newer schema (downgraded app) or garbage: start fresh rather than misread it.
    return typeof stored === "number" && stored <= version ? data : null;
  } catch {
    return null;
  }
}

const pending = new Map<StorageKey, { version: number; data: () => unknown; timer: ReturnType<typeof setTimeout> }>();
const lastWritten = new Map<StorageKey, string>();

async function write(key: StorageKey, version: number, data: unknown): Promise<void> {
  const raw = JSON.stringify({ version, data });
  if (lastWritten.get(key) === raw) return;
  lastWritten.set(key, raw);
  try {
    await AsyncStorage.setItem(key, raw);
  } catch {
    lastWritten.delete(key);
  }
}

/** Schedules a write; `data` is evaluated when the write happens (latest state wins). */
export function saveDocument(key: StorageKey, version: number, data: () => unknown, delayMs = 800): void {
  const existing = pending.get(key);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    pending.delete(key);
    void write(key, version, data());
  }, delayMs);
  pending.set(key, { version, data, timer });
}

/** Writes everything scheduled now (app going to the background). */
export async function flushDocuments(): Promise<void> {
  const writes = [...pending.entries()].map(([key, { version, data, timer }]) => {
    clearTimeout(timer);
    pending.delete(key);
    return write(key, version, data());
  });
  await Promise.all(writes);
}

/** A value that says when it changes (the app's stores, `state/store.ts`). */
export interface Observable<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

/**
 * Keeps a document saved from a store: once now (what was loaded, sanitized), then each time
 * `select` of the store's value changes. `data` is read when the write happens. Returns the stop.
 */
export function persistDocument<T>(
  source: Observable<T>,
  select: (value: T) => unknown,
  key: StorageKey,
  version: number,
  data: () => unknown,
  delayMs?: number,
): () => void {
  let last = select(source.get());
  saveDocument(key, version, data, delayMs);
  return source.subscribe(() => {
    const next = select(source.get());
    if (Object.is(next, last)) return;
    last = next;
    saveDocument(key, version, data, delayMs);
  });
}

/** Loads several documents at once: `{ name: [key, version] }` → `{ name: data or null }`. */
export async function loadDocuments<T extends Record<string, readonly [StorageKey, number]>>(specs: T): Promise<{ [K in keyof T]: unknown }> {
  const names = Object.keys(specs) as (keyof T)[];
  const values = await Promise.all(names.map((name) => loadDocument(specs[name][0], specs[name][1])));
  return Object.fromEntries(names.map((name, index) => [name, values[index]])) as { [K in keyof T]: unknown };
}

export async function removeDocuments(keys: StorageKey[]): Promise<void> {
  for (const key of keys) {
    const existing = pending.get(key);
    if (existing) clearTimeout(existing.timer);
    pending.delete(key);
    lastWritten.delete(key);
  }
  try {
    await AsyncStorage.multiRemove(keys);
  } catch {
    // ignore
  }
}
