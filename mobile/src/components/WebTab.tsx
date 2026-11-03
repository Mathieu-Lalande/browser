import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type Ref } from "react";
import { Linking, Platform, StyleSheet, View } from "react-native";
import { WebView as RNWebView } from "react-native-webview";
import type { WebViewProps } from "react-native-webview/lib/WebView";
import type { ShouldStartLoadRequest, WebViewNavigation } from "react-native-webview/lib/WebViewTypes";
import { getRandomBytes } from "expo-crypto";
import { boostHostOf } from "@shared/boosts";
import { isNavigableUrl } from "@shared/url";
import { boostScript, boostsForHost, type BoostPayload } from "../lib/boosts";
import { LINK_MENU_COOLDOWN_MS, linkMenuScript, parseLinkMenuMessage, type LinkMenuRequest } from "../lib/linkMenu";
import { decideNavigation, decideOpenWindow, isHttpsUpgradeFailure } from "../lib/navigation";
import { PASSWORD_PROMPT_COOLDOWN_MS, PasswordCaptureGuard, captureNonce } from "../lib/passwords";
import { MediaWatchGuard, newMediaNonce } from "../lib/media";
import { desktopUserAgent, parseReaderMessage, readerScript } from "../lib/reader";
import { TranslateBridge, translateNonce } from "../lib/translate";
import { AnnotateBridge, annotateNonce, marksFor } from "../lib/annotations";
import { AutofillBridge, autofillNonce } from "../lib/autofill";
import { useBrowserActions, useEvent } from "../state/BrowserProvider";
import { LoadError } from "./LoadError";
import type { WebTabProps } from "./webTabTypes";
import type { WebViewHandle } from "./webViewHandle";

// The package types the component as a plain function component; it does forward a ref.
const WebView = RNWebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebViewHandle> }>;

const INJECTED = linkMenuScript(Platform.OS);
const NO_BOOSTS: readonly BoostPayload[] = [];
const newCaptureNonce = () => captureNonce(getRandomBytes);
const newWatchNonce = () => newMediaNonce(getRandomBytes);
const newTranslateNonce = () => translateNonce(getRandomBytes);
const newAnnotateNonce = () => annotateNonce(getRandomBytes);
const newAutofillNonce = () => autofillNonce(getRandomBytes);
/** The selection menu's extra item (ADR-037). */
const HIGHLIGHT_MENU = [{ label: "Surligner", key: "highlight" }];
/** Only these schemes may ever reach the native view (navigation policy: `decideNavigation`). */
export const WEBVIEW_ORIGIN_WHITELIST = ["http://*", "https://*", "about:*", "data:*", "mailto:*", "tel:*", "sms:*"];

/**
 * One tab = one WebView. Hardened (see docs/DECISIONS.md, ADR-016): no file access, no mixed
 * content, no automatic popups, only http(s)/about/data navigations, and the only message the
 * app accepts from pages is a validated "long-pressed link" notice.
 *
 * Memoized on purpose: it re-renders only when what it must load changes, never while the page
 * navigates by itself or other tabs update.
 */
export const WebTab = memo(function WebTab({
  id,
  loadUrl,
  loadSeq,
  resumeUrl,
  upgradedFrom,
  isPrivate,
  active,
  background,
  bottomInset,
  onScroll,
  onLinkMenu,
  onPasswordCapture,
  desktopSite = false,
  readerToken = null,
  onReaderArticle,
  boosts = NO_BOOSTS,
  onMedia,
  translateRequest = null,
  autofillRequest = null,
  onTranslateBatch,
  onTranslateReset,
  annotations,
  onHighlight,
  onHighlightPress,
}: WebTabProps) {
  const actions = useBrowserActions();
  const ref = useRef<WebViewHandle | null>(null);
  const [generation, setGeneration] = useState(0);
  const upgradedFromRef = useRef(upgradedFrom);
  upgradedFromRef.current = upgradedFrom;
  const activeRef = useRef(active);
  activeRef.current = active;
  const lastMenu = useRef(0);
  const lastPasswordPrompt = useRef(0);
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

  // "Version ordinateur" toggled: reload with the new user agent (not on first render).
  const appliedDesktop = useRef(desktopSite);
  useEffect(() => {
    if (appliedDesktop.current === desktopSite) return;
    appliedDesktop.current = desktopSite;
    ref.current?.reload();
  }, [desktopSite]);

  // Boosts (ADR-029): only the current host's are ever sent to the page. At each document start
  // (built for the host followed from navigation events), again after each load (the start
  // script may have been built for the previous host; scripts still run once per document), and
  // restyled live when they change.
  const [boostHost, setBoostHost] = useState(() => boostHostOf(resumeUrl || loadUrl));
  const boostHostRef = useRef(boostHost);
  boostHostRef.current = boostHost;
  const boostsRef = useRef(boosts);
  boostsRef.current = boosts;
  const boostBootstrap = useMemo(() => {
    const matching = boostsForHost(boosts, boostHost);
    return matching.length ? boostScript(matching, boostHost) : undefined;
  }, [boosts, boostHost]);
  const appliedBoosts = useRef(boosts);
  useEffect(() => {
    if (appliedBoosts.current === boosts) return;
    appliedBoosts.current = boosts;
    const host = boostHostRef.current;
    ref.current?.injectJavaScript(boostScript(boostsForHost(boosts, host), host, true));
  }, [boosts]);

  // Login capture (ADR-025): normal tabs only; a script with a fresh nonce per main-frame document.
  const captureGuard = useRef<PasswordCaptureGuard | null>(null);
  captureGuard.current ??= new PasswordCaptureGuard(newCaptureNonce);
  // Media watcher (ADR-035): same nonce-per-document rule, private tabs included (nothing is stored).
  const mediaGuard = useRef<MediaWatchGuard | null>(null);
  mediaGuard.current ??= new MediaWatchGuard(newWatchNonce);
  // Translation (ADR-036): a nonce per request, messages accepted from this document only.
  const translateBridge = useRef<TranslateBridge | null>(null);
  translateBridge.current ??= new TranslateBridge(newTranslateNonce);
  // Highlights (ADR-037): normal tabs only, a nonce per document.
  const annotateBridge = useRef<AnnotateBridge | null>(null);
  annotateBridge.current ??= new AnnotateBridge(newAnnotateNonce);
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const drawnAnnotations = useRef(annotations);
  useEffect(() => {
    if (drawnAnnotations.current === annotations || !annotations || isPrivate) return;
    drawnAnnotations.current = annotations;
    const script = annotateBridge.current?.redraw(marksFor(annotations, currentUrl.current));
    if (script) ref.current?.injectJavaScript(script);
  }, [annotations, isPrivate]);
  // Autofill (ADR-041): on the user's tap only, a nonce per request, never in a private tab.
  const autofillBridge = useRef<AutofillBridge | null>(null);
  autofillBridge.current ??= new AutofillBridge(newAutofillNonce);
  useEffect(() => {
    if (!autofillRequest || isPrivate) return;
    const script = autofillBridge.current?.start(currentUrl.current, autofillRequest.choice);
    if (script) ref.current?.injectJavaScript(script);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autofillRequest?.seq]);
  const onCustomMenu = useEvent((event: { nativeEvent: { key: string } }) => {
    if (event.nativeEvent.key !== "highlight") return;
    const script = annotateBridge.current?.capture();
    if (script) ref.current?.injectJavaScript(script);
  });

  const onLoadStart = useEvent(() => {
    annotateBridge.current?.loadStarted();
    autofillBridge.current?.loadStarted();
    if (translateBridge.current?.active) onTranslateReset?.(id);
    translateBridge.current?.loadStarted();
    captureGuard.current?.loadStarted();
    mediaGuard.current?.loadStarted();
    onMedia?.(id, null);
  });
  const onLoadEnd = useEvent((event: { nativeEvent: { url: string } }) => {
    const { url } = event.nativeEvent;
    const host = boostHostOf(url);
    if (host !== boostHostRef.current) setBoostHost(host);
    const matching = boostsForHost(boostsRef.current, host);
    if (matching.length) ref.current?.injectJavaScript(boostScript(matching, host));
    const capture = isPrivate ? null : captureGuard.current?.loadEnded(url);
    if (capture) ref.current?.injectJavaScript(capture);
    const watch = mediaGuard.current?.loadEnded(url);
    if (watch) ref.current?.injectJavaScript(watch);
    if (!isPrivate && annotationsRef.current) {
      drawnAnnotations.current = annotationsRef.current;
      const annotate = annotateBridge.current?.loadEnded(url, marksFor(annotationsRef.current, url));
      if (annotate) ref.current?.injectJavaScript(annotate);
    }
  });

  // Reader mode requested: run Readability in the page; the answer comes back through onMessage.
  const readerTokenRef = useRef(readerToken);
  readerTokenRef.current = readerToken;
  useEffect(() => {
    if (readerToken) ref.current?.injectJavaScript(readerScript(readerToken));
  }, [readerToken]);

  // Translation requested (the menu): start the walker, or put the original text back.
  useEffect(() => {
    if (!translateRequest) return;
    const bridge = translateBridge.current!;
    const script = translateRequest.action === "translate" ? bridge.start(currentUrl.current) : bridge.restore();
    if (script) ref.current?.injectJavaScript(script);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translateRequest?.seq]);

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
    const host = boostHostOf(navigation.url);
    if (host && host !== boostHostRef.current) setBoostHost(host);
    actions.reportNavigation(id, {
      url: navigation.url,
      title: navigation.title,
      loading: navigation.loading,
      canGoBack: navigation.canGoBack,
      canGoForward: navigation.canGoForward,
    });
  });

  const onOpenWindow = useEvent((event: { nativeEvent: { targetUrl: string } }) => {
    // Web pages and about:blank only: never a top-level data: document opened by a page (ADR-018).
    const decision = decideOpenWindow(event.nativeEvent.targetUrl, actions.httpExceptions());
    if (decision.kind === "external") Linking.openURL(decision.url).catch(() => {});
    else if (decision.kind === "allow" || decision.kind === "upgrade") {
      actions.openUrl(decision.kind === "upgrade" ? decision.from : event.nativeEvent.targetUrl, { private: isPrivate, afterId: id });
    }
  });

  const onMessage = useEvent((event: { nativeEvent: { data: string; url: string } }) => {
    // Untrusted page input: validated, rate limited, and only for the tab on screen.
    if (!activeRef.current) return;
    const now = Date.now();
    // A reader answer: only for the pending request, checked against this tab's own page (ADR-026).
    const article = parseReaderMessage(event.nativeEvent.data, readerTokenRef.current, currentUrl.current);
    if (article !== undefined) {
      if (readerTokenRef.current) onReaderArticle?.(id, article);
      return;
    }
    // A batch of texts from this request's walker: translated by the app, written back as text.
    const segments = translateBridge.current?.parse(event.nativeEvent.data, event.nativeEvent.url, currentUrl.current);
    if (segments !== undefined) {
      if (segments?.length && onTranslateBatch) {
        onTranslateBatch(id, segments).then(
          (pairs) => {
            const script = translateBridge.current?.apply(pairs);
            if (script) ref.current?.injectJavaScript(script);
          },
          () => {},
        );
      }
      return;
    }
    // A form described for this tab's fill request: the values go in by field index.
    const fill = isPrivate ? undefined : autofillBridge.current?.parse(event.nativeEvent.data, event.nativeEvent.url, currentUrl.current);
    if (fill !== undefined) {
      if (fill) ref.current?.injectJavaScript(fill);
      return;
    }
    const annotate = isPrivate ? undefined : annotateBridge.current?.parse(event.nativeEvent.data, event.nativeEvent.url, currentUrl.current);
    if (annotate) {
      if (annotate.kind === "capture" && annotate.quote) onHighlight?.(id, currentUrl.current, annotate.quote);
      else if (annotate.kind === "click") onHighlightPress?.(id, annotate.id);
      return;
    }
    const media = mediaGuard.current?.parse(event.nativeEvent.data, event.nativeEvent.url, currentUrl.current);
    if (media !== undefined) {
      onMedia?.(id, media);
      return;
    }
    // A login capture: from this document's script (nonce), credited to this tab's page, never to
    // an origin the message names (ADR-025).
    const capture = isPrivate ? null : (captureGuard.current?.parse(event.nativeEvent.data, event.nativeEvent.url, currentUrl.current) ?? null);
    if (capture) {
      if (now - lastPasswordPrompt.current < PASSWORD_PROMPT_COOLDOWN_MS) return;
      lastPasswordPrompt.current = now;
      onPasswordCapture?.(id, capture);
      return;
    }
    const request: LinkMenuRequest | null = parseLinkMenuMessage(event.nativeEvent.data);
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
        originWhitelist={WEBVIEW_ORIGIN_WHITELIST}
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
        onLoadStart={onLoadStart}
        onLoadEnd={onLoadEnd}
        menuItems={isPrivate || !onHighlight ? undefined : HIGHLIGHT_MENU}
        onCustomMenuSelection={onCustomMenu}
        injectedJavaScript={INJECTED}
        injectedJavaScriptForMainFrameOnly
        injectedJavaScriptBeforeContentLoaded={boostBootstrap}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly
        userAgent={desktopSite ? desktopUserAgent(Platform.OS) : undefined}
        // Security. iOS: each private tab gets its own non-persistent data store. Android's
        // `incognito` wipes the cookies of every tab (global CookieManager), so it is not used
        // there: private tabs skip cache, form data and history but share cookies (ADR-016).
        incognito={isPrivate && Platform.OS === "ios"}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows
        allowFileAccess={false}
        // Android content:// access (other apps' files) has no prop in react-native-webview 14: its
        // RNCWebViewManagerImpl sets `settings.allowContentAccess = false` for every WebView
        // (checked for ADR-018; re-check on upgrades).
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
