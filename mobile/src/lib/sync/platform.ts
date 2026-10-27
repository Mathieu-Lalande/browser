import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchTransport, type Transport } from "@shared/sync/client";
import { SyncController, type SyncStatus } from "@shared/sync/controller";
import type { RandomBytes } from "@shared/sync/bytes";
import { isSyncCredentials, type SyncCredentials } from "@shared/sync/pairing";
import { getRandomBytes } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { mobileAdapters, mobileTabs, type MobileSyncStore } from "./adapters";

/**
 * Phone wiring of the shared sync controller (ADR-018): `fetch` for HTTP, `expo-crypto` for
 * randomness (Expo Go has no WebCrypto `subtle`; the ciphers are pure JS), the iOS Keychain /
 * Android Keystore (`expo-secure-store`) for the token and key, AsyncStorage for the engine state.
 */

export const SYNC_STATE_KEY = "browser.sync";
const CREDENTIALS_KEY = "browser.sync.credentials";

/** Random bytes from the OS (SecRandomCopyBytes / SecureRandom). */
export const expoRandomBytes: RandomBytes = (length) => getRandomBytes(length);

export const secureCredentials = {
  async load(): Promise<SyncCredentials | null> {
    try {
      const raw = await SecureStore.getItemAsync(CREDENTIALS_KEY);
      const value = raw ? (JSON.parse(raw) as unknown) : null;
      return isSyncCredentials(value) ? value : null;
    } catch {
      return null;
    }
  },
  async save(credentials: SyncCredentials | null): Promise<void> {
    if (!credentials) await SecureStore.deleteItemAsync(CREDENTIALS_KEY);
    else await SecureStore.setItemAsync(CREDENTIALS_KEY, JSON.stringify(credentials), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  },
};

export interface MobileSyncOptions {
  store: MobileSyncStore;
  onStatus: (status: SyncStatus) => void;
  /** Overrides for tests (in-memory server, fake storage). */
  transport?: Transport;
  rng?: RandomBytes;
  credentials?: { load(): Promise<SyncCredentials | null>; save(credentials: SyncCredentials | null): Promise<void> };
  state?: { load(): Promise<unknown>; save(state: unknown): void };
  debounceMs?: number;
  intervalMs?: number;
}

const asyncStorageState = {
  async load(): Promise<unknown> {
    try {
      const raw = await AsyncStorage.getItem(SYNC_STATE_KEY);
      return raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
      return null;
    }
  },
  save(state: unknown): void {
    void (state ? AsyncStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state)) : AsyncStorage.removeItem(SYNC_STATE_KEY)).catch(() => {});
  },
};

/** Coalesces state writes (the engine persists after each step). */
function debouncedState(target: { save(state: unknown): void }, delayMs = 500) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: unknown = null;
  return (state: unknown) => {
    latest = state && JSON.parse(JSON.stringify(state));
    if (!state) {
      if (timer) clearTimeout(timer);
      timer = null;
      target.save(null);
      return;
    }
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      target.save(latest);
    }, delayMs);
  };
}

export function deviceName(): string {
  if (Platform.OS === "ios") return Platform.isPad ? "iPad" : "iPhone";
  if (Platform.OS === "android") return "Android";
  return "Navigateur web";
}

export function createMobileSync(options: MobileSyncOptions): SyncController {
  const { store } = options;
  const credentials = options.credentials ?? secureCredentials;
  const state = options.state ?? asyncStorageState;
  return new SyncController({
    transport: options.transport ?? fetchTransport((url, init) => fetch(url, init)),
    rng: options.rng ?? expoRandomBytes,
    kind: "mobile",
    deviceName,
    localTabs: () => mobileTabs(store.model()),
    adapters: () => mobileAdapters(store),
    loadCredentials: () => credentials.load(),
    saveCredentials: (value) => credentials.save(value),
    loadState: () => state.load(),
    saveState: debouncedState(state),
    onStatus: options.onStatus,
    now: () => store.now(),
    debounceMs: options.debounceMs,
    intervalMs: options.intervalMs,
  });
}
