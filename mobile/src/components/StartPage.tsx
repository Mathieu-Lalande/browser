import type { Favorite } from "@shared/favorites";
import {
  LAYOUT_PRESETS,
  SIZE_LABELS,
  WIDGET_CATALOG,
  WIDGET_KINDS,
  addWidget,
  applyPreset,
  canAdd,
  moveWidget,
  removeWidget,
  resizeWidget,
  updateWidgetOptions,
  visibleWidgets,
  type StartWidget,
} from "@shared/start-widgets";
import { LinearGradient } from "expo-linear-gradient";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { BackHandler, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type LayoutRectangle } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { withAlpha } from "../lib/colors";
import { privateModeNotice } from "../lib/navigation";
import { dropIndex, widgetWidth } from "../lib/startWidgets";
import { useBrowserActions, useBrowserState, useEvent } from "../state/BrowserProvider";
import { useTheme } from "../state/theme";
import { Icon } from "./Icon";
import { BARE_KINDS, WidgetView, type WidgetActions } from "./StartWidgets";
import { Tap } from "./ui";

interface Props {
  bottomInset: number;
  onSearch: () => void;
  onOpen: (url: string) => void;
  onLongPressSite: (url: string, title: string) => void;
  /** Favorites grid (ADR-022). */
  onOpenFavorite: (url: string) => void;
  onFavoriteMenu: (favorite: Favorite) => void;
}

const GAP = 12;
const PADDING = 16;
const MAX_WIDTH = 760;
const SAVE_DELAY_MS = 400;

/**
 * The start page's widget list (ADR-034), shared with the desktop: edits show at once and are
 * saved right away, or after a pause while typing. In private mode nothing is saved.
 */
function useStartLayout(): { widgets: StartWidget[]; edit: (update: (widgets: StartWidget[]) => StartWidget[], typing?: boolean) => void } {
  const { settings } = useBrowserState();
  const actions = useBrowserActions();
  const { isPrivate } = useTheme();
  const [draft, setDraft] = useState<StartWidget[] | null>(null);
  const widgets = draft ?? settings.startPage.widgets;
  const latest = useRef(widgets);
  latest.current = widgets;
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; widgets: StartWidget[] } | null>(null);

  const save = useEvent((next: StartWidget[]) => {
    pending.current = null;
    actions.updateSettings({ startPage: { widgets: next } });
    setDraft(null);
  });
  const edit = useEvent((update: (widgets: StartWidget[]) => StartWidget[], typing = false) => {
    const next = update(latest.current);
    latest.current = next;
    setDraft(next);
    if (isPrivate) return;
    if (pending.current) clearTimeout(pending.current.timer);
    if (typing) pending.current = { timer: setTimeout(() => save(next), SAVE_DELAY_MS), widgets: next };
    else save(next);
  });

  // Leaving or entering private mode starts from the saved layout; pending notes are saved on the way out.
  useEffect(() => setDraft(null), [isPrivate]);
  useEffect(
    () => () => {
      if (!pending.current) return;
      clearTimeout(pending.current.timer);
      save(pending.current.widgets);
    },
    [save],
  );
  return { widgets, edit };
}

/** New tab page: the user's widgets; a long press anywhere arranges them. */
export const StartPage = memo(function StartPage({ bottomInset, onSearch, onOpen, onLongPressSite, onOpenFavorite, onFavoriteMenu }: Props) {
  const { colors, dark, isPrivate } = useTheme();
  const { width } = useWindowDimensions();
  const { widgets: all, edit } = useStartLayout();
  const widgets = visibleWidgets(all, { mobile: true, isPrivate });
  const [editing, setEditing] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [dragging, setDragging] = useState(false);
  const rects = useRef(new Map<string, LayoutRectangle>());
  const gridWidth = Math.min(width, MAX_WIDTH) - PADDING * 2;

  useEffect(() => {
    if (!editing) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => (setEditing(false), true));
    return () => sub.remove();
  }, [editing]);

  const actions: WidgetActions = {
    onSearch,
    onOpen,
    onLongPressSite,
    onOpenFavorite,
    onFavoriteMenu,
    setOptions: (id, patch, typing) => edit((list) => updateWidgetOptions(list, id, patch), typing),
  };

  const drop = useEvent((id: string, dx: number, dy: number) => {
    setDragging(false);
    const from = rects.current.get(id);
    if (!from) return;
    const shown = widgets.map((widget) => rects.current.get(widget.id) ?? { x: 0, y: 0, width: 0, height: 0 });
    const target = widgets[dropIndex(shown, { x: from.x + from.width / 2 + dx, y: from.y + from.height / 2 + dy })];
    if (target && target.id !== id) edit((list) => moveWidget(list, id, list.findIndex((widget) => widget.id === target.id)));
  });

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <LinearGradient
        colors={[withAlpha(colors.accent, dark ? 0.32 : 0.22), withAlpha(colors.accent2, dark ? 0.12 : 0.1), "transparent"]}
        locations={[0, 0.45, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.8, y: 0.9 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        scrollEnabled={!dragging}
      >
        {editing && (
          <View style={[styles.toolbar, { backgroundColor: colors.bgElevated, borderColor: colors.hairline }]} accessibilityRole="toolbar">
            <Chip label="Ajouter" icon="plus" primary onPress={() => setGallery(true)} />
            {LAYOUT_PRESETS.map((preset) => (
              <Chip key={preset.id} label={preset.label} onPress={() => edit((list) => applyPreset(list, preset.id))} />
            ))}
            <Chip label="Terminé" icon="check" onPress={() => setEditing(false)} testID="start-done" />
          </View>
        )}
        {isPrivate && (
          <View style={styles.hero}>
            <View style={[styles.privateBadge, { backgroundColor: colors.accentSoft }]}>
              <Icon name="mask" size={32} color={colors.accentText} />
            </View>
            <Text style={[styles.heading, { color: colors.text }]} accessibilityRole="header">
              Navigation privée
            </Text>
            <Text style={[styles.privateText, { color: colors.textMuted }]}>{privateModeNotice(Platform.OS)}</Text>
          </View>
        )}
        <View style={[styles.grid, { width: gridWidth }]}>
          {widgets.map((widget, index) => (
            <WidgetCard
              key={widget.id}
              widget={widget}
              width={widgetWidth(widget, gridWidth, GAP)}
              editing={editing}
              position={index + 1}
              total={widgets.length}
              onEnterEdit={() => setEditing(true)}
              onLayout={(rect) => rects.current.set(widget.id, rect)}
              onDragStart={() => setDragging(true)}
              onDrop={drop}
              onRemove={() => edit((list) => removeWidget(list, widget.id))}
              onResize={() => {
                const sizes = WIDGET_CATALOG[widget.kind].sizes;
                edit((list) => resizeWidget(list, widget.id, sizes[(sizes.indexOf(widget.size) + 1) % sizes.length]));
              }}
              onMove={(delta) => {
                const target = widgets[index + delta];
                if (target) edit((list) => moveWidget(list, widget.id, list.findIndex((other) => other.id === target.id)));
              }}
            >
              <WidgetView widget={widget} actions={actions} width={widgetWidth(widget, gridWidth, GAP) - (BARE_KINDS.has(widget.kind) ? 0 : 32)} />
            </WidgetCard>
          ))}
        </View>
        {!editing && (
          <Tap accessibilityRole="button" onPress={() => setEditing(true)} style={styles.customize} testID="start-customize">
            <Icon name="layout-dashboard" size={16} color={colors.textMuted} />
            <Text style={[styles.customizeText, { color: colors.textMuted }]}>Personnaliser</Text>
          </Tap>
        )}
      </ScrollView>
      <Gallery
        visible={gallery}
        widgets={all}
        isPrivate={isPrivate}
        onClose={() => setGallery(false)}
        onAdd={(kind) => {
          edit((list) => addWidget(list, kind));
          setGallery(false);
        }}
      />
    </View>
  );
});

function Chip({ label, icon, primary, onPress, testID }: { label: string; icon?: "plus" | "check"; primary?: boolean; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Tap
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={[styles.chip, { backgroundColor: primary ? colors.accent : colors.surface }]}
      pressScale={0.95}
    >
      {icon && <Icon name={icon} size={14} color={primary ? colors.onAccent : colors.text} />}
      <Text style={[styles.chipText, { color: primary ? colors.onAccent : colors.text }]}>{label}</Text>
    </Tap>
  );
}

interface CardProps {
  widget: StartWidget;
  width: number;
  editing: boolean;
  position: number;
  total: number;
  onEnterEdit: () => void;
  onLayout: (rect: LayoutRectangle) => void;
  onDragStart: () => void;
  onDrop: (id: string, dx: number, dy: number) => void;
  onRemove: () => void;
  onResize: () => void;
  onMove: (delta: number) => void;
  children: ReactNode;
}

/**
 * A widget's frame. Edit mode: dragged by its handle (Reanimated follows the finger; the list
 * reorders on release, without layout animation), resized, removed; screen readers get
 * "move up / down" actions instead of the drag.
 */
const WidgetCard = memo(function WidgetCard({ widget, width, editing, position, total, onEnterEdit, onLayout, onDragStart, onDrop, onRemove, onResize, onMove, children }: CardProps) {
  const { colors, reduceMotion } = useTheme();
  const info = WIDGET_CATALOG[widget.kind];
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const lifted = useSharedValue(0);
  const pan = usePanGesture({
    enabled: editing,
    onActivate: () => {
      "worklet";
      lifted.value = 1;
      scheduleOnRN(onDragStart);
    },
    onUpdate: (event) => {
      "worklet";
      x.value = event.translationX;
      y.value = event.translationY;
    },
    onDeactivate: (event) => {
      "worklet";
      scheduleOnRN(onDrop, widget.id, event.translationX, event.translationY);
    },
    onFinalize: () => {
      "worklet";
      lifted.value = 0;
      x.value = 0;
      y.value = 0;
    },
  });
  // Opacity and transform only, on the same view: no layout animation here.
  const style = useAnimatedStyle(() => ({
    opacity: 1 - lifted.value * 0.25,
    zIndex: lifted.value ? 10 : 0,
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: reduceMotion ? 1 : 1 + lifted.value * 0.03 }],
  }));
  const card = !BARE_KINDS.has(widget.kind) || editing;

  return (
    <Animated.View
      style={[{ width }, card && [styles.card, { backgroundColor: withAlpha(colors.bgElevated, 0.9), borderColor: colors.hairline }], style]}
      onLayout={(event) => onLayout(event.nativeEvent.layout)}
      accessible={editing}
      accessibilityLabel={editing ? `${info.label}, position ${position} sur ${total}` : undefined}
      accessibilityActions={
        editing
          ? [
              { name: "moveUp", label: "Monter" },
              { name: "moveDown", label: "Descendre" },
              { name: "remove", label: "Retirer" },
            ]
          : undefined
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "moveUp") onMove(-1);
        else if (event.nativeEvent.actionName === "moveDown") onMove(1);
        else if (event.nativeEvent.actionName === "remove") onRemove();
      }}
      testID={`widget-${widget.id}`}
    >
      {editing && (
        <View style={styles.cardBar}>
          <GestureDetector gesture={pan}>
            <View style={styles.handle} accessibilityLabel={`Déplacer ${info.label}`}>
              <Icon name="grip-vertical" size={16} color={colors.textMuted} />
              <Text style={[styles.cardLabel, { color: colors.textMuted }]} numberOfLines={1}>
                {info.label}
              </Text>
            </View>
          </GestureDetector>
          {info.sizes.length > 1 && (
            <Tap accessibilityRole="button" accessibilityLabel={`Taille : ${SIZE_LABELS[widget.size]}`} onPress={onResize} style={styles.sizeButton}>
              <Text style={[styles.cardLabel, { color: colors.text }]}>{SIZE_LABELS[widget.size]}</Text>
            </Tap>
          )}
          <Tap accessibilityRole="button" accessibilityLabel={`Retirer ${info.label}`} onPress={onRemove} style={styles.iconButton}>
            <Icon name="close" size={16} color={colors.textMuted} />
          </Tap>
        </View>
      )}
      <Pressable onLongPress={editing ? undefined : onEnterEdit} delayLongPress={450} disabled={editing} accessible={false}>
        <View pointerEvents={editing ? "none" : "auto"} style={editing && styles.inert}>
          {children}
        </View>
      </Pressable>
    </Animated.View>
  );
});

function Gallery({ visible, widgets, isPrivate, onClose, onAdd }: { visible: boolean; widgets: StartWidget[]; isPrivate: boolean; onClose: () => void; onAdd: (kind: StartWidget["kind"]) => void }) {
  const { colors } = useTheme();
  const kinds = WIDGET_KINDS.filter((kind) => WIDGET_CATALOG[kind].mobile && !(isPrivate && WIDGET_CATALOG[kind].revealsHabits));
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha("#000000", 0.4) }]} onPress={onClose} accessibilityLabel="Fermer" />
      <View style={[styles.sheet, { backgroundColor: colors.bgElevated }]} accessibilityViewIsModal>
        <Text style={[styles.sheetTitle, { color: colors.text }]} accessibilityRole="header">
          Ajouter un widget
        </Text>
        <ScrollView>
          {kinds.map((kind) => {
            const info = WIDGET_CATALOG[kind];
            const allowed = canAdd(widgets, kind);
            return (
              <Tap key={kind} accessibilityRole="button" disabled={!allowed} onPress={() => onAdd(kind)} style={[styles.galleryRow, !allowed && styles.disabled]}>
                <View style={[styles.galleryIcon, { backgroundColor: colors.accentSoft }]}>
                  <Icon name={info.icon} size={20} color={colors.accentText} />
                </View>
                <View style={styles.galleryText}>
                  <Text style={[styles.galleryLabel, { color: colors.text }]}>{info.label}</Text>
                  <Text style={[styles.galleryHint, { color: colors.textMuted }]}>{allowed ? info.description : "Déjà sur la page."}</Text>
                </View>
              </Tap>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: PADDING, paddingTop: 56, alignItems: "center", gap: 20 },
  toolbar: { flexDirection: "row", flexWrap: "wrap", gap: 6, padding: 8, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, justifyContent: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 17 },
  chipText: { fontSize: 14, fontWeight: "600" },
  hero: { alignItems: "center", gap: 6, maxWidth: 520 },
  heading: { fontSize: 34, fontWeight: "800", letterSpacing: -0.6, textAlign: "center" },
  privateBadge: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  privateText: { fontSize: 15, lineHeight: 21, textAlign: "center", marginTop: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  card: { borderRadius: 22, padding: 16, borderWidth: StyleSheet.hairlineWidth },
  cardBar: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10, marginTop: -6 },
  handle: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36 },
  cardLabel: { fontSize: 13, fontWeight: "600" },
  sizeButton: { paddingHorizontal: 10, height: 30, justifyContent: "center" },
  iconButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  inert: { opacity: 0.7 },
  customize: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, height: 36 },
  customizeText: { fontSize: 14, fontWeight: "500" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "75%", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, paddingBottom: 32 },
  sheetTitle: { fontSize: 18, fontWeight: "700", marginBottom: 10 },
  galleryRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  galleryIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  galleryText: { flex: 1, gap: 2 },
  galleryLabel: { fontSize: 16, fontWeight: "600" },
  galleryHint: { fontSize: 13 },
  disabled: { opacity: 0.45 },
});

