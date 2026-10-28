import { displayUrl } from "@shared/url";
import { memo, useEffect, useMemo, useState, type ComponentType } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView as RNWebView } from "react-native-webview";
import type { WebViewProps } from "react-native-webview/lib/WebView";
import type { ShouldStartLoadRequest, WebViewNavigation } from "react-native-webview/lib/WebViewTypes";
import { scheduleOnRN } from "react-native-worklets";
import { rubberBand, shouldDismissSheet } from "../lib/gestures";
import { decideNavigation, decideOpenWindow } from "../lib/navigation";
import { useBrowserActions, useEvent } from "../state/BrowserProvider";
import { useTheme } from "../state/theme";
import { Icon } from "./Icon";
import { IconButton, Tap } from "./ui";
import { WEBVIEW_ORIGIN_WHITELIST } from "./WebTab";

const WebView = RNWebView as unknown as ComponentType<WebViewProps>;

export interface PeekRequest {
  url: string;
  /** Same privacy mode as the tab the link comes from. */
  isPrivate: boolean;
  /** The tab the link comes from: "Ouvrir dans un onglet" opens next to it. */
  afterId?: string;
}

interface Props {
  peek: PeekRequest;
  onClose: () => void;
}

/**
 * Link peek on the phone (ADR-027): a bottom sheet with a second WebView, hardened like a tab's
 * (same props, same navigation rules), without any injected script nor message bridge. Swiping
 * the header down (or tapping the backdrop, or the close button) dismisses it.
 *
 * Animations: only `translateY` on the sheet and `opacity` on the separate backdrop view, both
 * driven by one shared value — no layout animation (entering/exiting) anywhere here, never on a
 * view whose opacity is animated as well.
 */
export const PeekSheet = memo(function PeekSheet({ peek, onClose }: Props) {
  const { colors, haptic, reduceMotion } = useTheme();
  const actions = useBrowserActions();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const sheetHeight = Math.round(height * 0.88);
  /** 0 = open, sheetHeight = off screen. */
  const offset = useSharedValue(sheetHeight);
  const [source, setSource] = useState(() => ({ uri: peek.url }));
  const [page, setPage] = useState({ url: peek.url, title: "", loading: true });

  useEffect(() => {
    offset.value = reduceMotion ? 0 : withSpring(0, { damping: 24, stiffness: 240, overshootClamping: true });
  }, [offset, reduceMotion]);

  /** Slides out, then unmounts. */
  const dismiss = useEvent(() => {
    if (reduceMotion) return onClose();
    offset.value = withTiming(sheetHeight, { duration: 200, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) scheduleOnRN(onClose);
    });
  });

  const drag = usePanGesture({
    activeOffsetY: [-10, 10],
    onUpdate: (event) => {
      "worklet";
      offset.value = event.translationY >= 0 ? event.translationY : rubberBand(event.translationY, 120, 0.4);
    },
    onDeactivate: (event) => {
      "worklet";
      if (shouldDismissSheet(event.translationY, event.velocityY, sheetHeight)) {
        offset.value = withTiming(sheetHeight, { duration: 180, easing: Easing.out(Easing.cubic) }, (finished) => {
          if (finished) scheduleOnRN(onClose);
        });
      } else {
        offset.value = withSpring(0, { damping: 22, stiffness: 260, overshootClamping: true });
      }
    },
  });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: Math.max(-40, offset.value) }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: interpolate(offset.value, [0, sheetHeight], [1, 0], "clamp") }));

  const onShouldStart = useEvent((request: ShouldStartLoadRequest) => {
    const decision = decideNavigation({ url: request.url, isTopFrame: request.isTopFrame !== false }, actions.httpExceptions());
    switch (decision.kind) {
      case "allow":
        return true;
      case "upgrade":
        // HTTPS-Only (ADR-007): the upgraded address loads in the sheet itself.
        setSource({ uri: decision.url });
        return false;
      case "external":
        Linking.openURL(decision.url).catch(() => {});
        return false;
      case "block":
        return false;
    }
  });

  const onNavigationStateChange = useEvent((navigation: WebViewNavigation) => {
    if (!/^https?:/i.test(navigation.url)) return;
    setPage({ url: navigation.url, title: navigation.title, loading: navigation.loading });
  });

  /** A link the peeked page opens in a new window becomes a real tab (web pages only, ADR-018). */
  const onOpenWindow = useEvent((event: { nativeEvent: { targetUrl: string } }) => {
    const decision = decideOpenWindow(event.nativeEvent.targetUrl, actions.httpExceptions());
    if (decision.kind === "external") Linking.openURL(decision.url).catch(() => {});
    else if (decision.kind === "allow" || decision.kind === "upgrade") {
      actions.openUrl(decision.kind === "upgrade" ? decision.from : event.nativeEvent.targetUrl, { private: peek.isPrivate, afterId: peek.afterId });
      onClose();
    }
  });

  /** "Ouvrir dans un onglet": the page shown in the sheet, reloaded in a new tab next to its source. */
  const openInTab = useEvent(() => {
    haptic("selection");
    actions.openUrl(page.url, { private: peek.isPrivate, afterId: peek.afterId });
    onClose();
  });

  const title = page.title && page.title !== page.url ? page.title : displayUrl(page.url);
  const webProps = useMemo(() => hardenedWebViewProps(peek.isPrivate), [peek.isPrivate]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityRole="button" accessibilityLabel="Fermer l'aperçu" />
      </Animated.View>
      <Animated.View
        style={[styles.sheet, { height: sheetHeight + 40, bottom: -40, paddingBottom: 40 + insets.bottom, backgroundColor: colors.bgElevated }, sheetStyle]}
        accessibilityViewIsModal
        accessibilityLabel="Aperçu du lien"
      >
        <GestureDetector gesture={drag}>
          <View style={[styles.header, { borderBottomColor: colors.hairline }]}>
            <View style={[styles.grabber, { backgroundColor: colors.border }]} />
            <View style={styles.row}>
              <View style={styles.headerText}>
                <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
                  {title}
                </Text>
                <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={1}>
                  {page.loading ? "Chargement…" : displayUrl(page.url)}
                </Text>
              </View>
              <Tap
                onPress={openInTab}
                accessibilityRole="button"
                accessibilityLabel="Ouvrir dans un onglet"
                style={[styles.open, { backgroundColor: colors.surface }]}
              >
                <Icon name="open" size={16} color={colors.accentText} />
                <Text style={[styles.openLabel, { color: colors.accentText }]}>Ouvrir dans un onglet</Text>
              </Tap>
              <IconButton icon="close" label="Fermer" onPress={dismiss} size={22} />
            </View>
          </View>
        </GestureDetector>
        <View style={styles.body}>
          <WebView
            source={source}
            style={[styles.web, { backgroundColor: colors.bg }]}
            onShouldStartLoadWithRequest={onShouldStart}
            onNavigationStateChange={onNavigationStateChange}
            onOpenWindow={onOpenWindow}
            {...webProps}
          />
        </View>
      </Animated.View>
    </View>
  );
});

/** The security props of a tab's WebView (ADR-016, ADR-018), for the peek's own. */
function hardenedWebViewProps(isPrivate: boolean): Partial<WebViewProps> {
  return {
    originWhitelist: WEBVIEW_ORIGIN_WHITELIST,
    incognito: isPrivate && Platform.OS === "ios",
    javaScriptCanOpenWindowsAutomatically: false,
    setSupportMultipleWindows: true,
    allowFileAccess: false,
    allowFileAccessFromFileURLs: false,
    allowUniversalAccessFromFileURLs: false,
    mixedContentMode: "never",
    geolocationEnabled: false,
    thirdPartyCookiesEnabled: false,
    saveFormDataDisabled: isPrivate,
    cacheEnabled: !isPrivate,
    webviewDebuggingEnabled: __DEV__,
    allowsInlineMediaPlayback: true,
    allowsLinkPreview: false,
    mediaPlaybackRequiresUserAction: true,
    automaticallyAdjustContentInsets: false,
  };
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -4 },
    elevation: 16,
  },
  header: { paddingTop: 8, paddingBottom: 6, paddingLeft: 16, paddingRight: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  grabber: { alignSelf: "center", width: 36, height: 5, borderRadius: 3, marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: "600" },
  subtitle: { fontSize: 12.5 },
  open: { flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 17 },
  openLabel: { fontSize: 13.5, fontWeight: "600" },
  body: { flex: 1 },
  web: { flex: 1 },
});
