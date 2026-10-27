import { memo, useEffect } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { siteHost, siteHue } from "../lib/site";
import { useBrowserActions } from "../state/BrowserProvider";
import type { WebTabProps } from "./webTabTypes";

/**
 * Web-only stand-in for the native WebView (react-native-webview has no web implementation).
 * Used for design previews/screenshots with `expo start --web`: it draws a placeholder article
 * and reports a finished navigation. It is never shipped to phones.
 */
export const WebTab = memo(function WebTab({ id, loadUrl, active, background, bottomInset, onScroll }: WebTabProps) {
  const actions = useBrowserActions();
  const host = siteHost(loadUrl) || loadUrl;
  const hue = siteHue(loadUrl);

  useEffect(() => {
    // No title: the tab keeps the one it already has (as a real page would report it).
    actions.reportNavigation(id, { url: loadUrl, title: "", loading: false, canGoBack: true, canGoForward: false });
  }, [actions, host, id, loadUrl]);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: background }, !active && styles.hidden]} pointerEvents={active ? "auto" : "none"}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomInset + 24 }}
        scrollEventThrottle={16}
        onScroll={(event) => {
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          onScroll(contentOffset.y, contentSize.height, layoutMeasurement.height);
        }}
        style={{ backgroundColor: "#ffffff" }}
      >
        <View style={[styles.hero, { backgroundColor: `hsl(${hue}, 70%, 42%)` }]}>
          <Text style={styles.kicker}>{host.toUpperCase()}</Text>
          <Text style={styles.heroTitle}>Un navigateur pensé pour le pouce</Text>
        </View>
        {Array.from({ length: 6 }, (_, index) => (
          <View key={index} style={styles.paragraph}>
            <View style={[styles.line, { width: "92%" }]} />
            <View style={[styles.line, { width: "86%" }]} />
            <View style={[styles.line, { width: "95%" }]} />
            <View style={[styles.line, { width: "60%" }]} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  hidden: { opacity: 0, zIndex: -1 },
  hero: { paddingHorizontal: 22, paddingTop: 36, paddingBottom: 30, gap: 10 },
  kicker: { color: "rgba(255,255,255,0.75)", fontWeight: "700", letterSpacing: 1.2, fontSize: 12 },
  heroTitle: { color: "white", fontSize: 30, fontWeight: "800", lineHeight: 34 },
  paragraph: { paddingHorizontal: 22, paddingTop: 20, gap: 9 },
  line: { height: 11, borderRadius: 6, backgroundColor: "#e7e5ee" },
});
