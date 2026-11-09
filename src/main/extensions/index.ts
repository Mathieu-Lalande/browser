import { dialog, type BaseWindow } from "electron";
import type { DroppedExtension, ExtensionDetailsInfo, ExtensionInfo, ExtensionInstallResult, ExtensionReview, ExtensionUpdateResult } from "@shared/extensions";
import type { StoreInstall } from "@shared/webstore-page";
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
  /** Opens an extension page main built (its options) in a new tab of the window. */
  openExtensionPage(url: string): void;
  /** An extension was installed from this window: its chrome UI shows the confirmation. */
  extensionInstalled(id: string): void;
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

/** A successful install: the window it was started from shows the confirmation (its chrome UI anchors it). */
const announce =
  (c: ExtensionWindow) =>
  (result: ExtensionInstallResult): ExtensionInstallResult => {
    if (result?.ok) c.extensionInstalled(result.extension.id);
    return result;
  };

export const installFromWebStore =(c: ExtensionWindow, webStoreId: string): Promise<ExtensionInstallResult> =>
  extensions().installFromWebStore(webStoreId, reviewIn(c)).then(announce(c));

export const storeInstalls = (): StoreInstall[] => extensions().storeInstalls();
export const extensionDetails = (id: string): ExtensionDetailsInfo | null => extensions().detailsOf(id);

/** A package dropped on `browser://extensions`: installed after the permission review. */
export const installDroppedExtension = (c: ExtensionWindow, dropped: DroppedExtension): Promise<ExtensionInstallResult> =>
  extensions().installDropped(dropped, reviewIn(c)).then(announce(c));

/** "Ouvrir les options": the extension's options page in a new tab (where the extension is loaded). */
export function openExtensionOptions(c: ExtensionWindow, id: string): boolean {
  const url = extensions().optionsUrl(c.tabSession, id);
  if (url) c.openExtensionPage(url);
  return !!url;
}

/** "Supprimer de Browser" on a store page: a native confirmation, as Chrome asks, then removal. */
export async function removeFromStorePage(c: ExtensionWindow, webStoreId: string): Promise<void> {
  const extension = extensions().byWebStoreId(webStoreId);
  if (!extension) return;
  const { response } = await dialog.showMessageBox(c.window, {
    type: "question",
    buttons: ["Supprimer", "Annuler"],
    defaultId: 1,
    cancelId: 1,
    message: `Supprimer « ${extension.name} » ?`,
    detail: "L'extension et ses données seront retirées de Browser.",
  });
  if (response === 0) await extensions().remove(extension.id);
}

/** The confirmation after an install, hanging from the window's extension bar (`anchor`). */
export function showInstalledExtension(c: ExtensionWindow, id: string, anchor: Bounds): void {
  if (listExtensions().some((extension) => extension.id === id)) c.overlay.open({ kind: "extension-installed", extensionId: id, anchor });
}

export const updateExtensions =(c: ExtensionWindow): Promise<ExtensionUpdateResult> => extensions().checkUpdates(reviewIn(c));

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
