import * as SecureStore from "expo-secure-store";
import { TranslateKeys } from "../lib/translate";

/** Translation API keys (ADR-036): Keychain (this device only, when unlocked) / Android Keystore. */
export const translateKeys = new TranslateKeys(SecureStore, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
