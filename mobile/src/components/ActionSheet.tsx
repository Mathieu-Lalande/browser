import { memo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../state/theme";
import { Icon, type IconName } from "./Icon";
import { SiteIcon } from "./ui";

export interface MenuItem {
  key: string;
  label: string;
  icon: IconName;
  destructive?: boolean;
  /** Closes the sheet then runs (unless it returns another menu to show). */
  onPress: () => MenuSpec | void;
}

export interface MenuSpec {
  title?: string;
  subtitle?: string;
  /** Shows the site's icon next to the title. */
  siteUrl?: string;
  /** An explanation shown above the actions (site info). */
  note?: string;
  items: MenuItem[];
}

interface Props {
  menu: MenuSpec | null;
  onClose: () => void;
  onReplace: (menu: MenuSpec) => void;
}

/** Native-feeling bottom sheet menu (link long-press, tab context menu, page actions). */
export const ActionSheet = memo(function ActionSheet({ menu, onClose, onReplace }: Props) {
  const { colors, haptic, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  if (!menu) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Fermer le menu" />
      </Animated.View>
      <Animated.View
        entering={reduceMotion ? FadeIn.duration(120) : SlideInDown.springify().damping(22).stiffness(260)}
        exiting={reduceMotion ? FadeOut.duration(100) : SlideOutDown.duration(180)}
        style={[styles.sheet, { backgroundColor: colors.bgElevated, paddingBottom: insets.bottom + 10, maxHeight: height * 0.8 }]}
        accessibilityViewIsModal
      >
        <View style={[styles.grabber, { backgroundColor: colors.border }]} />
        {(menu.title || menu.subtitle) && (
          <View style={[styles.header, { borderBottomColor: colors.hairline }]}>
            {menu.siteUrl !== undefined && <SiteIcon url={menu.siteUrl} title={menu.title} size={36} />}
            <View style={styles.headerText}>
              {menu.title ? (
                <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
                  {menu.title}
                </Text>
              ) : null}
              {menu.subtitle ? (
                <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={2}>
                  {menu.subtitle}
                </Text>
              ) : null}
            </View>
          </View>
        )}
        {menu.note ? <Text style={[styles.note, { color: colors.textMuted }]}>{menu.note}</Text> : null}
        <ScrollView bounces={false} contentContainerStyle={styles.items}>
          {menu.items.map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              onPress={() => {
                haptic("selection");
                const next = item.onPress();
                if (next) onReplace(next);
                else onClose();
              }}
              style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.surfaceActive }]}
            >
              <View style={[styles.itemIcon, { backgroundColor: item.destructive ? "transparent" : colors.surface }]}>
                <Icon name={item.icon} size={20} color={item.destructive ? colors.danger : colors.text} />
              </View>
              <Text style={[styles.itemLabel, { color: item.destructive ? colors.danger : colors.text }]}>{item.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 8,
    borderRadius: 28,
    paddingTop: 8,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  grabber: { alignSelf: "center", width: 36, height: 5, borderRadius: 3, marginBottom: 6 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: "600" },
  subtitle: { fontSize: 13 },
  note: { fontSize: 13, lineHeight: 18, paddingHorizontal: 20, paddingTop: 10 },
  items: { paddingVertical: 6, paddingHorizontal: 8 },
  item: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 52, paddingHorizontal: 12, borderRadius: 16 },
  itemIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  itemLabel: { fontSize: 16, fontWeight: "500", flex: 1 },
});
