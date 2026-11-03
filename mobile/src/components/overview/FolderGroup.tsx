import { memo, type ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { FOLDER_HEADER } from "../../lib/overviewLayout";
import type { MobileFolder, MobileTab } from "../../lib/tabs";
import { useTheme } from "../../state/theme";
import { Icon } from "../Icon";
import { Tap } from "../ui";

/** A folder of the grid (ADR-022): a full-width header; tap folds it, long press opens its menu. */
export const FolderHeader = memo(function FolderHeader({
  folder,
  count,
  onToggle,
  onLongPress,
}: {
  folder: MobileFolder;
  count: number;
  onToggle: (id: string) => void;
  onLongPress: (folder: MobileFolder) => void;
}) {
  const { colors, haptic } = useTheme();
  return (
    <Tap
      accessibilityRole="button"
      accessibilityState={{ expanded: !folder.collapsed }}
      accessibilityLabel={`Dossier ${folder.name}, ${count} onglet${count > 1 ? "s" : ""}`}
      accessibilityHint="Toucher pour replier ou déplier, maintenir pour plus d'options"
      onPress={() => {
        haptic("selection");
        onToggle(folder.id);
      }}
      onLongPress={() => {
        haptic("medium");
        onLongPress(folder);
      }}
      pressScale={0.98}
      style={[styles.folder, { backgroundColor: colors.surface, borderColor: colors.hairline }]}
      testID={`folder-${folder.id}`}
    >
      <View style={{ transform: [{ rotate: folder.collapsed ? "0deg" : "90deg" }] }}>
        <Icon name="forward" size={16} color={colors.textMuted} strokeWidth={2.2} />
      </View>
      <Icon name="folder" size={18} color={colors.accentText} />
      <Text style={[styles.folderName, { color: colors.text }]} numberOfLines={1}>
        {folder.name}
      </Text>
      <Text style={[styles.folderCount, { color: colors.textMuted }]}>{count}</Text>
    </Tap>
  );
});

/**
 * A folder's header and, unfolded, its cards (`renderTab`). A fragment: header and cards are items
 * of the grid's own wrapping row, like the loose cards.
 */
export function FolderGroup({
  folder,
  tabs,
  renderTab,
  onToggle,
  onLongPress,
}: {
  folder: MobileFolder;
  tabs: MobileTab[];
  renderTab: (tab: MobileTab) => ReactElement;
  onToggle: (id: string) => void;
  onLongPress: (folder: MobileFolder) => void;
}) {
  return (
    <>
      <FolderHeader folder={folder} count={tabs.length} onToggle={onToggle} onLongPress={onLongPress} />
      {folder.collapsed ? null : tabs.map(renderTab)}
    </>
  );
}

const styles = StyleSheet.create({
  folder: {
    width: "100%",
    height: FOLDER_HEADER,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  folderName: { flex: 1, fontSize: 15, fontWeight: "700" },
  folderCount: { fontSize: 13, fontWeight: "600" },
});
