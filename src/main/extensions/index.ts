import type { BaseWindow } from "electron";
import type { ExtensionInfo, ExtensionInstallResult, ExtensionReview, ExtensionUpdateResult } from "@shared/extensions";
import type { Bounds } from "@shared/types";
import { appServices } from "../app-services-ref";
import type { Overlay } from "../overlay";
import type { ExtensionPopup } from "./popup";
import { showExtensionMenu } from "./toolbar-menu";

/** Browser extensions (ADR-024, ADR-049): function facades over the app's `ExtensionService` (./service.ts). */

const extensions = () => appServices().extensions;

/** The parts of a window the store install, popups and menus use (a BrowserController). */
export interface ExtensionWindow {
  readonly window: BaseWindow;
  readonly overlay: Overlay;
  readonly extensionPopup: ExtensionPopup;
  readonly tabSession: Electron.Session;
  openExtensions(): void;
}

export const listExtensions = (): ExtensionInfo[] => extensions().list();
export const installFromFolder = (window: BaseWindow | null): Promise<ExtensionInstallResult> => extensions().installFromFolder(window);
export const installFromFile = (window: BaseWindow | null): Promise<ExtensionInstallResult> => extensions().installFromFile(window);
export const setExtensionEnabled = (id: string, enabled: boolean): Promise<void> => extensions().setEnabled(id, enabled);
export const setExtensionPrivateAllowed = (id: string, allowPrivate: boolean): Promise<void> => extensions().setPrivateAllowed(id, allowPrivate);
export const setExtensionPinned = (id: string, pinned: boolean): Promise<void> => extensions().setPinned(id, pinned);
export const removeExtension = (id: string): Promise<void> => extensions().remove(id);
export const webStoreTestOrigin = (): string | null => extensions().webStoreTestOrigin;
export const extensionReview = (reviewId: string): ExtensionReview | null => extensions().reviews.get(reviewId);
export const answerExtensionReview = (reviewId: string, accepted: boolean): void => extensions().reviews.answer(reviewId, accepted);

/** The permission review of a window: the overlay's "extension-install" panel. */
const reviewIn = (c: ExtensionWindow) => (review: ExtensionReview) =>
  extensions().reviews.ask(review, (reviewId) => c.overlay.open({ kind: "extension-install", reviewId }));

export const installFromWebStore = (c: ExtensionWindow, webStoreId: string): Promise<ExtensionInstallResult> =>
  extensions().installFromWebStore(webStoreId, reviewIn(c));

export const updateExtensions = (c: ExtensionWindow): Promise<ExtensionUpdateResult> => extensions().checkUpdates(reviewIn(c));

/** Opens an extension's popup below its toolbar button, in the session of the window's pages. */
export function openExtensionPopup(c: ExtensionWindow, id: string, anchor: Bounds): void {
  const url = extensions().popupUrl(c.tabSession, id);
  if (url) c.extensionPopup.open(url, anchor);
}

/** The puzzle menu (`id` null) or an extension button's menu. */
export function showExtensionsMenu(c: ExtensionWindow, id: string | null, anchor: Bounds): void {
  showExtensionMenu(
    {
      window: c.window,
      list: listExtensions,
      openPopup: (extensionId, at) => openExtensionPopup(c, extensionId, at),
      setPinned: (extensionId, pinned) => void setExtensionPinned(extensionId, pinned),
      openExtensionsPage: () => c.openExtensions(),
    },
    id,
    anchor,
  );
}
