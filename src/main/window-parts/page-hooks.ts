import type { WebContents } from "electron";
import type { TabId } from "@shared/types";
import type { PageAnnotator } from "../annotations";
import type { BoostService } from "../boosts/service";
import type { MediaHub } from "../media";
import type { PageGestures } from "../page-swipe";
import type { LinkPeek } from "../peek";
import type { TabManagerHooks } from "../tabs";
import type { PageTranslator } from "../translate";

/** The window's per-page features, read when a hook fires (they exist once the window is built). */
export interface PageFeatures {
  readonly isPrivate: boolean;
  readonly peek: Pick<LinkPeek, "open">;
  readonly gestures: Pick<PageGestures, "feedPage" | "zoom">;
  readonly media: Pick<MediaHub, "report">;
  readonly translator: Pick<PageTranslator, "pageReady" | "stateOf">;
  readonly annotator: Pick<PageAnnotator, "pageReady" | "clicked">;
}

export interface PageHooksDeps {
  /** What every window does with its pages (history, bookmarks, favorites, saved passwords). */
  base: TabManagerHooks;
  features: PageFeatures;
  boosts: Pick<BoostService, "boostPage">;
  /** The page context menu (ADR-021, ADR-033). */
  contextMenu(tabId: TabId, params: Electron.ContextMenuParams): void;
  /** Password form watching in a new document (ADR-025). */
  watchPasswordForms(tabId: TabId, contents: WebContents): void;
  /** The page swipe's wheel watcher in a new document (ADR-033). */
  watchPageWheel(contents: WebContents): void;
}

/**
 * The per-page feature hooks of one window's tabs: boosts, passwords, peek, gestures, media,
 * translation and annotations, each routed to the feature that owns it.
 */
export class PageHooks {
  constructor(private readonly deps: PageHooksDeps) {}

  /** The hooks every TabManager of the window gets (`tabHooksFor` then drops a private window's profile writers). */
  hooks(): TabManagerHooks {
    const { base, features, boosts } = this.deps;
    return {
      ...base,
      contextMenu: (tabId, params) => this.deps.contextMenu(tabId, params),
      pageReady: (tabId, contents) => this.deps.watchPasswordForms(tabId, contents),
      boostPage: (contents) => boosts.boostPage(contents, features.isPrivate),
      peekLink: (tabId, url) => features.peek.open(tabId, url),
      gesturePage: (contents) => this.deps.watchPageWheel(contents),
      pageWheel: (tabId, sample) => features.gestures.feedPage(tabId, sample),
      pageZoom: (tabId, direction) => features.gestures.zoom(tabId, direction),
      media: (tabId, contents, playing) => features.media.report(tabId, contents, playing),
      translatePage: (tabId, contents) => void features.translator.pageReady(tabId, contents),
      translation: (tabId) => features.translator.stateOf(tabId),
      annotatePage: (tabId, contents) => features.annotator.pageReady(tabId, contents),
      annotationClick: (tabId, click) => features.annotator.clicked(tabId, click),
    };
  }
}
