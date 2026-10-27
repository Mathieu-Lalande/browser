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
