import type { AutofillData } from "@shared/autofill";
import * as SecureStore from "expo-secure-store";
import { useEffect, useSyncExternalStore } from "react";
import { AutofillStore } from "../lib/autofill";

/** Saved addresses and cards (ADR-041), in `expo-secure-store` (this device only, when unlocked). */
export const autofill = new AutofillStore(SecureStore, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });

const subscribe = (listener: () => void) => autofill.subscribe(listener);
const snapshot = () => autofill.current;

export function useAutofill(): AutofillData {
  useEffect(() => {
    autofill.load().catch(() => {});
  }, []);
  return useSyncExternalStore(subscribe, snapshot);
}
