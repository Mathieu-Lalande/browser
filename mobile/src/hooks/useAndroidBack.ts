import { useEffect } from "react";
import { BackHandler } from "react-native";
import { useEvent } from "./useEvent";

/** Android's back button: `onBack` returns true when it handled it (else the app goes back/out). */
export function useAndroidBack(onBack: () => boolean): void {
  const handler = useEvent(onBack);
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", handler);
    return () => subscription.remove();
  }, [handler]);
}
