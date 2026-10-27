import type { LinkMenuRequest } from "../lib/linkMenu";

export interface WebTabProps {
  id: string;
  loadUrl: string;
  loadSeq: number;
  upgradedFrom: string | null;
  isPrivate: boolean;
  /** Shown and interactive (others stay mounted but hidden). */
  active: boolean;
  background: string;
  /** Space under the floating toolbar the page can scroll into (iOS content inset). */
  bottomInset: number;
  onScroll: (y: number, contentHeight: number, viewportHeight: number) => void;
  onLinkMenu: (tabId: string, request: LinkMenuRequest) => void;
}
