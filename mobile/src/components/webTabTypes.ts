import type { PasswordCapture } from "@shared/passwords";
import type { ReaderArticle } from "@shared/reader";
import type { LinkMenuRequest } from "../lib/linkMenu";

export interface WebTabProps {
  id: string;
  loadUrl: string;
  loadSeq: number;
  /** The tab's current page (`mountUrl`): where the WebView starts when it is created. */
  resumeUrl: string;
  upgradedFrom: string | null;
  isPrivate: boolean;
  /** Shown and interactive (others stay mounted but hidden). */
  active: boolean;
  background: string;
  /** Space under the floating toolbar the page can scroll into (iOS content inset). */
  bottomInset: number;
  onScroll: (y: number, contentHeight: number, viewportHeight: number) => void;
  onLinkMenu: (tabId: string, request: LinkMenuRequest) => void;
  /** A login form was submitted in a normal tab (ADR-025): offer to save the password. */
  onPasswordCapture?: (tabId: string, capture: PasswordCapture) => void;
  /** "Version ordinateur" (ADR-026): a desktop user agent, applied with a reload. */
  desktopSite?: boolean;
  /** A pending reader mode request (ADR-026): set, the page runs Readability and answers with this token. */
  readerToken?: string | null;
  /** The answer to `readerToken`: the validated article, or null when the page has none. */
  onReaderArticle?: (tabId: string, article: ReaderArticle | null) => void;
}
