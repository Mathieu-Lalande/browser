/**
 * Page load failures (Chromium net error codes, `did-fail-load`) grouped into families the
 * built-in error page explains in plain French. Pure: shared by main and the chrome UI.
 */

/** A main-frame load that failed; the tab shows the error page instead of its (blank) view. */
import { t } from "./i18n";

export interface LoadError {
  /** Chromium net error code (negative), e.g. -105 for ERR_NAME_NOT_RESOLVED. */
  code: number;
  /** Chromium's description, e.g. "ERR_NAME_NOT_RESOLVED". */
  description: string;
  url: string;
}

/**
 * Not a net error: the page's renderer process crashed or was ended (task manager, ADR-042). The
 * tab shows "Cette page a planté" with a reload button, like a failed load.
 */
export const PAGE_CRASHED = -100000;

export type LoadErrorFamily = "crashed" | "dns" | "offline" | "refused" | "reset" | "timeout" | "certificate" | "redirects" | "unreachable" | "blocked" | "other";

export interface LoadErrorText {
  family: LoadErrorFamily;
  title: string;
  /** One sentence; `{host}` is replaced by the site's host. */
  message: string;
  /** What the user can try. */
  advice: string;
}

const TEXTS: Record<LoadErrorFamily, Omit<LoadErrorText, "family">> = {
  crashed: {
    get title() { return t("loadError.pageCrashed") },
    get message() { return t("loadError.processShowingStoppedRest") },
    get advice() { return t("loadError.reloadPageIfCrashes") },
  },
  dns: {
    get title() { return t("loadError.siteNotFound") },
    get message() { return t("loadError.addressCouldntFound") },
    get advice() { return t("loadError.checkSpellingAddressTry") },
  },
  offline: {
    get title() { return t("loadError.noInternetConnection") },
    get message() { return t("loadError.deviceIsntConnectedAny") },
    get advice() { return t("loadError.checkWiFiNetwork") },
  },
  refused: {
    get title() { return t("loadError.connectionRefused") },
    get message() { return t("loadError.refusedConnection") },
    get advice() { return t("loadError.siteMayDownDoesnt") },
  },
  reset: {
    get title() { return t("loadError.connectionInterrupted") },
    get message() { return t("loadError.connectionWasCutBefore") },
    get advice() { return t("loadError.reloadPageIfProblem") },
  },
  timeout: {
    get title() { return t("loadError.siteTakingTooLong") },
    get message() { return t("loadError.didntRespondTime") },
    get advice() { return t("loadError.siteMayOverloadedTry") },
  },
  certificate: {
    get title() { return t("loadError.notSecureConnection") },
    get message() { return t("loadError.certificateIsntValidConnection") },
    get advice() { return t("loadError.someoneMayTryingIntercept") },
  },
  redirects: {
    get title() { return t("loadError.tooManyRedirects") },
    get message() { return t("loadError.redirectsLoop") },
    get advice() { return t("loadError.clearingSitesCookiesOften") },
  },
  unreachable: {
    get title() { return t("loadError.siteUnreachable") },
    get message() { return t("loadError.cantReach") },
    get advice() { return t("loadError.checkConnectionTryAgain") },
  },
  blocked: {
    get title() { return t("loadError.addressBlocked") },
    get message() { return t("loadError.browserDoesntOpenPort") },
    get advice() { return t("loadError.checkAddressPortsReserved") },
  },
  other: {
    get title() { return t("loadError.cantShowPage") },
    get message() { return t("loadError.loadingFailed") },
    get advice() { return t("loadError.reloadPageTryAgain") },
  },
};

/** The family of a Chromium net error code. */
export function loadErrorFamily(code: number): LoadErrorFamily {
  if (code === PAGE_CRASHED) return "crashed";
  if (code === -105 || code === -137) return "dns"; // NAME_NOT_RESOLVED, NAME_RESOLUTION_FAILED
  if (code === -106 || code === -21) return "offline"; // INTERNET_DISCONNECTED, NETWORK_CHANGED
  if (code === -102) return "refused"; // CONNECTION_REFUSED
  if (code === -100 || code === -101 || code === -324 || code === -103) return "reset"; // CLOSED, RESET, EMPTY_RESPONSE, ABORTED
  if (code === -7 || code === -118) return "timeout"; // TIMED_OUT, CONNECTION_TIMED_OUT
  if (code <= -200 && code > -300) return "certificate"; // CERT_* range
  if (code === -107 || code === -113 || code === -117) return "certificate"; // SSL_PROTOCOL_ERROR, SSL_VERSION_OR_CIPHER_MISMATCH, BAD_SSL_CLIENT_AUTH_CERT
  if (code === -310) return "redirects"; // TOO_MANY_REDIRECTS
  if (code === -104 || code === -109 || code === -108) return "unreachable"; // CONNECTION_FAILED, ADDRESS_UNREACHABLE, ADDRESS_INVALID
  if (code === -312 || code === -20 || code === -301) return "blocked"; // UNSAFE_PORT, BLOCKED_BY_CLIENT, DISALLOWED_URL_SCHEME
  return "other";
}

/** What the error page says for `error`. */
export function describeLoadError(error: LoadError): LoadErrorText {
  const family = loadErrorFamily(error.code);
  let host = error.url;
  try {
    host = new URL(error.url).host || error.url;
  } catch {
    // Not a URL: shown as is.
  }
  const text = TEXTS[family];
  return { family, ...text, message: text.message.replace("{host}", host || "ce site") };
}
