/** Imperative methods of a react-native-webview instance that the app uses. */
export interface WebViewHandle {
  goBack(): void;
  goForward(): void;
  reload(): void;
  stopLoading(): void;
  injectJavaScript(script: string): void;
}
