import { NativeModule, requireOptionalNativeModule } from "expo";

/** A download the Android WebView handed over (patched react-native-webview, ADR-055). */
export interface NativeDownloadEvent {
  /** React tag of the WebView that started it. */
  tag: number;
  url: string;
  userAgent: string;
  contentDisposition: string;
  mimeType: string;
  contentLength: number;
  /** Cookies of the WebView's own profile for `url` ("" when none). */
  cookie: string;
}

type WebSessionEvents = {
  onDownload(event: NativeDownloadEvent): void;
};

declare class WebSessionModule extends NativeModule<WebSessionEvents> {
  /** Whether private tabs get their own WebView profile (androidx.webkit MULTI_PROFILE). */
  privateProfiles(): boolean;
  /** The Cookie header the normal or private WebViews would send to `url`. */
  cookieHeader(url: string, privateTab: boolean): Promise<string>;
  /** Wipes the private profile (cookies, storage); false when profiles are not supported. */
  clearPrivateProfile(): Promise<boolean>;
  /** Deletes the storage and cookies of these origins in the shared jar (fallback without profiles). */
  clearOrigins(origins: string[]): Promise<number>;
}

/** Android only (`modules/web-session`, ADR-055); null on iOS, the web and in Expo Go. */
export const WebSession = requireOptionalNativeModule<WebSessionModule>("WebSession");
