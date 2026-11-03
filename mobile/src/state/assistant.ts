import * as SecureStore from "expo-secure-store";
import { AssistantKey } from "../lib/assistant";

/** The assistant's Anthropic API key (ADR-044): Keychain (this device only, when unlocked) / Android Keystore. */
export const assistantKey = new AssistantKey(SecureStore, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
