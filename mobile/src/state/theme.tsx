import * as Haptics from "expo-haptics";
import { createContext, use, useMemo, type ReactNode } from "react";
import { Platform, useColorScheme } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { colorsFor, type AppColors } from "../lib/colors";
import { PRIVATE_SPACE_ID } from "../lib/tabs";
import { useBrowserState } from "./BrowserProvider";

export interface Theme {
  colors: AppColors;
  dark: boolean;
  isPrivate: boolean;
  /** System "reduce motion" or the app setting: animations become instant fades. */
  reduceMotion: boolean;
  haptic: (kind?: "selection" | "light" | "medium" | "success" | "warning") => void;
}

const ThemeContext = createContext<Theme | null>(null);

export function useTheme(): Theme {
  const theme = use(ThemeContext);
  if (!theme) throw new Error("useTheme outside ThemeProvider");
  return theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings, mobile, model } = useBrowserState();
  const system = useColorScheme();
  const systemReduceMotion = useReducedMotion();
  const isPrivate = model.activeSpaceId === PRIVATE_SPACE_ID;
  const spaceColor = model.spaces.find((space) => space.id === model.activeSpaceId)?.color ?? null;

  const colors = useMemo(
    () => colorsFor(settings, system === "dark" || system === "light" ? system : null, spaceColor, isPrivate),
    [settings, system, spaceColor, isPrivate],
  );
  const reduceMotion = systemReduceMotion || settings.appearance.reduceMotion;
  const hapticsOn = mobile.haptics && Platform.OS !== "web";

  const theme = useMemo<Theme>(
    () => ({
      colors,
      dark: colors.scheme === "dark",
      isPrivate,
      reduceMotion,
      haptic(kind = "selection") {
        if (!hapticsOn) return;
        const done = () => {};
        if (kind === "selection") Haptics.selectionAsync().catch(done);
        else if (kind === "success" || kind === "warning")
          Haptics.notificationAsync(kind === "success" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(done);
        else Haptics.impactAsync(kind === "medium" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(done);
      },
    }),
    [colors, isPrivate, reduceMotion, hapticsOn],
  );
  return <ThemeContext value={theme}>{children}</ThemeContext>;
}

/** Shared sizes (8-pt grid, 44-pt minimum touch targets). */
export const metrics = {
  touch: 44,
  radius: 14,
  radiusLarge: 22,
  pill: 999,
  bar: 52,
  collapsedBar: 30,
  gutter: 16,
} as const;

export const fonts = {
  /** Rounded system font where available (SF Pro Rounded on iOS). */
  display: Platform.select({ ios: "System", default: undefined }),
};
