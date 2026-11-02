import type { MediaProbe } from "@shared/media";
import type { PasswordCapture } from "@shared/passwords";
import type { ReaderArticle } from "@shared/reader";
import type { Segment } from "@shared/translate/segments";
import type { BoostPayload } from "../lib/boosts";
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
  /** Enabled boosts (ADR-029) for this kind of tab (scripts filtered for private tabs); keep the array stable. */
  boosts?: readonly BoostPayload[];
  /** The page's media state (ADR-035), null when a new document starts loading. Private tabs too: nothing is kept. */
  onMedia?: (tabId: string, probe: MediaProbe | null) => void;
  /** Page translation (ADR-036): a new `seq` starts translating the page, or restores the original. */
  translateRequest?: { seq: number; action: "translate" | "restore" } | null;
  /** Texts of the page to translate (validated): resolves to the translations to write back. */
  onTranslateBatch?: (tabId: string, segments: Segment[]) => Promise<[number, string][]>;
  /** A new document started loading: its translation (if any) is gone. */
  onTranslateReset?: (tabId: string) => void;
}
