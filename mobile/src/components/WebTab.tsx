import { memo, useCallback, useMemo, useRef, useState, type ComponentType, type Ref } from "react";
import { Linking, Platform, StyleSheet, View } from "react-native";
import { WebView as RNWebView } from "react-native-webview";
import type { WebViewProps } from "react-native-webview/lib/WebView";
import type { ShouldStartLoadRequest, WebViewNavigation } from "react-native-webview/lib/WebViewTypes";
import { isNavigableUrl } from "@shared/url";
import { LINK_MENU_COOLDOWN_MS, linkMenuScript, parseLinkMenuMessage, type LinkMenuRequest } from "../lib/linkMenu";
import { decideNavigation, isHttpsUpgradeFailure } from "../lib/navigation";
import { useBrowserActions, useEvent } from "../state/BrowserProvider";
import { LoadError } from "./LoadError";
import type { WebTabProps } from "./webTabTypes";
import type { WebViewHandle } from "./webViewHandle";

// The package types the component as a plain function component; it does forward a ref.
const WebView = RNWebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebViewHandle> }>;

const INJECTED = linkMenuScript(Platform.OS);
/** Only these schemes may ever reach the native view (navigation policy: `decideNavigation`). */
const ORIGIN_WHITELIST = ["http://*", "https://*", "about:*", "data:*", "mailto:*", "tel:*", "sms:*"];

/**
 * One tab = one WebView. Hardened (see docs/DECISIONS.md, ADR-016): no file access, no mixed
 * content, no automatic popups, only http(s)/about/data navigations, and the only message the
 * app accepts from pages is a validated "long-pressed link" notice.
 *
 * Memoized on purpose: it re-renders only when what it must load changes, never while the page
 * navigates by itself or other tabs update.
 */
export const WebTab = memo(function WebTab({ id, loadUrl, loadSeq, resumeUrl, upgradedFrom, isPrivate, active, background, bottomInset, onScroll, onLinkMenu }: WebTabProps) {
  const actions = useBrowserActions();
  const ref = useRef<WebViewHandle | null>(null);
  const [generation, setGeneration] = useState(0);
  const upgradedFromRef = useRef(upgradedFrom);
  upgradedFromRef.current = upgradedFrom;
  const activeRef = useRef(active);
  activeRef.current = active;
  const lastMenu = useRef(0);
  /** The page committed last, followed from the WebView's own navigation events. */
  const currentUrl = useRef(resumeUrl);
  /**
   * Where a new WebView starts: the tab's current page (a tab coming back after being unmounted,
   * or revived), for as long as no newer explicit load (`loadSeq`) was requested.
   */
  const start = useRef({ uri: resumeUrl, seq: loadSeq });

  // A new object only when a new load is requested (loadSeq) or the WebView is recreated, so
  // in-page navigation never reloads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const source = useMemo(() => ({ uri: start.current.seq === loadSeq ? start.current.uri : loadUrl }), [loadUrl, loadSeq, generation]);

  const setRef = useCallback(
    (view: WebViewHandle | null) => {
      ref.current = view;
      actions.registerWebView(id, view);
    },
    [actions, id],
  );

  const onShouldStart = useEvent((request: ShouldStartLoadRequest) => {
    const decision = decideNavigation({ url: request.url, isTopFrame: request.isTopFrame !== false }, actions.httpExceptions());
    switch (decision.kind) {
      case "allow":
        return true;
      case "upgrade":
        actions.upgrade(id, decision.url, decision.from);
        return false;
      case "external":
        Linking.openURL(decision.url).catch(() => {});
        return false;
      case "block":
        return false;
    }
  });

  const onNavigationStateChange = useEvent((navigation: WebViewNavigation) => {
    // Same rule as the tab model: about:blank (start-up) and refused schemes are not pages.
    if (isNavigableUrl(navigation.url) && navigation.url !== "about:blank") currentUrl.current = navigation.url;
    actions.reportNavigation(id, {
      url: navigation.url,
      title: navigation.title,
      loading: navigation.loading,
      canGoBack: navigation.canGoBack,
      canGoForward: navigation.canGoForward,
    });
  });

  const onOpenWindow = useEvent((event: { nativeEvent: { targetUrl: string } }) => {
    const decision = decideNavigation({ url: event.nativeEvent.targetUrl, isTopFrame: true }, actions.httpExceptions());
    if (decision.kind === "external") Linking.openURL(decision.url).catch(() => {});
    else if (decision.kind === "allow" || decision.kind === "upgrade") {
      actions.openUrl(decision.kind === "upgrade" ? decision.from : event.nativeEvent.targetUrl, { private: isPrivate, afterId: id });
    }
  });

  const onMessage = useEvent((event: { nativeEvent: { data: string } }) => {
    // Untrusted page input: validated, rate limited, and only for the tab on screen.
    if (!activeRef.current) return;
    const request: LinkMenuRequest | null = parseLinkMenuMessage(event.nativeEvent.data);
    const now = Date.now();
    if (!request || now - lastMenu.current < LINK_MENU_COOLDOWN_MS) return;
    lastMenu.current = now;
    onLinkMenu(id, request);
  });

  const onError = useEvent((event: { nativeEvent: { code: number; url: string } }) => {
    const { code, url } = event.nativeEvent;
    const from = upgradedFromRef.current;
    if (from && url.startsWith("https:") && isHttpsUpgradeFailure(Platform.OS, code)) actions.httpsFailed(id, from);
  });

  const onScrollEvent = useEvent(
    (event: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => {
      if (!activeRef.current) return;
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      onScroll(contentOffset.y, contentSize.height, layoutMeasurement.height);
    },
  );

  // The web content process died (memory pressure): start a fresh WebView on the current page.
  const revive = useEvent(() => {
    start.current = { uri: currentUrl.current || loadUrl, seq: loadSeq };
    setGeneration((value) => value + 1);
  });
  const renderError = useCallback((_domain: string | undefined, code: number, description: string) => (
    <LoadError code={code} description={description} onRetry={() => ref.current?.reload()} />
  ), []);

  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: background }, !active && styles.hidden]}
      pointerEvents={active ? "auto" : "none"}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
    >
      <WebView
        key={generation}
        ref={setRef}
        source={source}
        style={[styles.web, { backgroundColor: background }]}
        originWhitelist={ORIGIN_WHITELIST}
        onShouldStartLoadWithRequest={onShouldStart}
        onNavigationStateChange={onNavigationStateChange}
        onLoadProgress={(event: { nativeEvent: { progress: number } }) => actions.reportProgress(id, event.nativeEvent.progress)}
        onOpenWindow={onOpenWindow}
        onMessage={onMessage}
        onError={onError}
        renderError={renderError}
        onScroll={onScrollEvent}
        onContentProcessDidTerminate={revive}
        onRenderProcessGone={revive}
        injectedJavaScript={INJECTED}
        injectedJavaScriptForMainFrameOnly
        // Security. iOS: each private tab gets its own non-persistent data store. Android's
        // `incognito` wipes the cookies of every tab (global CookieManager), so it is not used
        // there: private tabs skip cache, form data and history but share cookies (ADR-016).
        incognito={isPrivate && Platform.OS === "ios"}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        geolocationEnabled={false}
        thirdPartyCookiesEnabled={false}
        saveFormDataDisabled={isPrivate}
        cacheEnabled={!isPrivate}
        webviewDebuggingEnabled={__DEV__}
        // Behavior
        pullToRefreshEnabled
        allowsBackForwardNavigationGestures
        allowsInlineMediaPlayback
        allowsFullscreenVideo
        allowsLinkPreview={false}
        mediaPlaybackRequiresUserAction
        decelerationRate="normal"
        automaticallyAdjustContentInsets={false}
        contentInset={{ bottom: bottomInset }}
        startInLoadingState={false}
      />
    </View>
  );
}, sameProps);

/** `resumeUrl` only matters when the WebView is created: the page navigating does not re-render the tab. */
function sameProps(previous: WebTabProps, next: WebTabProps): boolean {
  return (Object.keys(next) as (keyof WebTabProps)[]).every((key) => key === "resumeUrl" || previous[key] === next[key]);
}

const styles = StyleSheet.create({
  web: { flex: 1 },
  hidden: { opacity: 0, zIndex: -1 },
});
