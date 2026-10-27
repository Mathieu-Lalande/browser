import { memo, useState, type ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { faviconUrl, monogram } from "../lib/site";
import { useTheme } from "../state/theme";
import { Icon, type IconName } from "./Icon";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface TapProps extends Omit<PressableProps, "style"> {
  style?: StyleProp<ViewStyle>;
  /** How much the element shrinks while pressed. */
  pressScale?: number;
  children?: ReactNode;
}

/** Pressable with a springy press-down effect (skipped with reduced motion). */
export function Tap({ style, pressScale = 0.95, children, onPressIn, onPressOut, ...props }: TapProps) {
  const { reduceMotion } = useTheme();
  const scale = useSharedValue(1);
  const pressed = useSharedValue(0);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }], opacity: 1 - pressed.value * 0.15 }));
  return (
    <AnimatedPressable
      {...props}
      onPressIn={(event) => {
        if (reduceMotion) pressed.value = withTiming(1, { duration: 60 });
        else scale.value = withSpring(pressScale, { damping: 20, stiffness: 500 });
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        pressed.value = withTiming(0, { duration: 120 });
        scale.value = withSpring(1, { damping: 14, stiffness: 300 });
        onPressOut?.(event);
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}

interface IconButtonProps {
  icon: IconName;
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  color?: string;
  size?: number;
  filled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** 44×44 touch target around an icon, with an accessibility label. */
export const IconButton = memo(function IconButton({ icon, label, onPress, onLongPress, disabled, color, size = 24, filled, style, testID }: IconButtonProps) {
  const { colors } = useTheme();
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={4}
      pressScale={0.88}
      style={[styles.iconButton, style, disabled && styles.disabled]}
      testID={testID}
    >
      <Icon name={icon} size={size} color={color ?? colors.text} filled={filled} />
    </Tap>
  );
});

interface SiteIconProps {
  url: string;
  title?: string;
  size?: number;
  /** No network request (private tabs). */
  offline?: boolean;
  radius?: number;
}

/**
 * The site's favicon (its own logo, shown as is), or a neutral themed tile when there is none (or
 * offline): surface background, hairline border and the site's initial in the muted text color.
 */
export const SiteIcon = memo(function SiteIcon({ url, title = "", size = 20, offline = false, radius }: SiteIconProps) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const source = offline || failed ? null : faviconUrl(url);
  const corner = radius ?? Math.round(size * 0.28);
  if (!url) {
    return <SiteGlyph size={size} radius={corner} />;
  }
  const tile = !loaded;
  return (
    <View
      style={[
        styles.siteIcon,
        { width: size, height: size, borderRadius: corner },
        tile && { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
      ]}
      testID="site-icon"
    >
      {tile && (
        <Text style={[styles.monogram, { color: colors.textMuted, fontSize: size * 0.5, lineHeight: size * 0.66 }]} allowFontScaling={false} testID="site-monogram">
          {monogram(url, title)}
        </Text>
      )}
      {source && (
        <Image
          source={{ uri: source }}
          style={[StyleSheet.absoluteFill, { borderRadius: corner, opacity: loaded ? 1 : 0 }]}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      )}
    </View>
  );
});

/** The start page has no site: a neutral tile with a Lucide glyph. */
function SiteGlyph({ size, radius }: { size: number; radius: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.siteIcon,
        { width: size, height: size, borderRadius: radius, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <Icon name="sparkles" size={Math.max(12, Math.round((size * 0.6) / 4) * 4)} color={colors.textMuted} strokeWidth={size < 24 ? 2 : 1.75} />
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text style={[styles.sectionTitle, { color: colors.textMuted }]} accessibilityRole="header">
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22 },
  disabled: { opacity: 0.35 },
  siteIcon: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  monogram: { fontWeight: "600", textAlign: "center" },
  sectionTitle: { fontSize: 13, fontWeight: "600", letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 8, marginTop: 4 },
});
