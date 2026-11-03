import * as Clipboard from "expo-clipboard";
import { Platform, Share } from "react-native";
import type { Theme } from "../state/theme";
import { useEvent } from "./useEvent";

/** Copy to the clipboard (a success haptic once done) and the system share sheet. */
export function useShareActions(haptic: Theme["haptic"]) {
  const share = useEvent((url: string, title?: string) => {
    Share.share(Platform.OS === "ios" ? { url, title } : { message: url, title }).catch(() => {});
  });
  const copy = useEvent((text: string) => {
    Clipboard.setStringAsync(text).then(() => haptic("success"), () => {});
  });
  return { share, copy };
}
