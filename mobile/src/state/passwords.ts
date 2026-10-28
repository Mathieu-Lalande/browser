import type { PasswordVault } from "@shared/passwords";
import * as SecureStore from "expo-secure-store";
import { useEffect, useSyncExternalStore } from "react";
import { PasswordStore } from "../lib/passwords";

/**
 * The app's saved passwords (ADR-025), in `expo-secure-store`: iOS Keychain (this device only,
 * when unlocked) and Android Keystore. Loaded on first use.
 */
export const passwords = new PasswordStore(SecureStore, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });

const subscribe = (listener: () => void) => passwords.subscribe(listener);
const snapshot = () => passwords.current;

export function usePasswords(): PasswordVault {
  useEffect(() => {
    passwords.load().catch(() => {});
  }, []);
  return useSyncExternalStore(subscribe, snapshot);
}
