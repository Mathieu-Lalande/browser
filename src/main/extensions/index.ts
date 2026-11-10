import { t } from "@shared/i18n";
import { dialog, type BaseWindow } from "electron";
import type { DroppedExtension, ExtensionDetailsInfo, ExtensionInfo, ExtensionInstallResult, ExtensionReview, ExtensionUpdateResult } from "@shared/extensions";
import type { StoreInstall } from "@shared/webstore-page";
import type { ActionState } from "@shared/extension-api";
import { isExecuteAction } from "@shared/extension-commands";
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
  readonly tabs: { readonly activeTabId: string | null };
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
export const extensionDetails = (id: string): ExtensionDetailsInfo | null => extensionDetailsWithShortcuts(id);

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
    buttons: [t("extensionsIndex.delete"), t("extensionsIndex.cancel")],
    defaultId: 1,
    cancelId: 1,
    message: t("extensionsIndex.delete2", { name: extension.name }),
    detail: t("extensionsIndex.extensionDataWillRemoved"),
  });
  if (response === 0) await extensions().remove(extension.id);
}

/** The confirmation after an install, hanging from the window's extension bar (`anchor`). */
export function showInstalledExtension(c: ExtensionWindow, id: string, anchor: Bounds): void {
  if (listExtensions().some((extension) => extension.id === id)) c.overlay.open({ kind: "extension-installed", extensionId: id, anchor });
}

export const updateExtensions =(c: ExtensionWindow): Promise<ExtensionUpdateResult> => extensions().checkUpdates(reviewIn(c));

/** The badges, titles and icons the extensions set (ADR-053). */
export const extensionActionStates = (): Record<string, ActionState> => appServices().extensionApi.actionStates();

/**
 * A click on an extension's button: its popup below the button, in the session of the window's
 * pages; without one (or after `action.setPopup({ popup: "" })`), `action.onClicked` (ADR-053).
 */
export function openExtensionPopup(c: ExtensionWindow, id: string, anchor: Bounds): void {
  const api = appServices().extensionApi;
  const tabId = c.tabs.activeTabId;
  if (!api.actionEnabled(id, tabId)) return;
  const override = api.popupFor(id, tabId);
  const url = override === "" ? null : extensions().popupUrl(c.tabSession, id, override);
  if (url) c.extensionPopup.open(url, anchor);
  else api.clickAction(id, c.window.id);
}

export const onExtensionsChanged = (listener: () => void): (() => void) => extensions().onChanged(listener);

/** An installed extension shortcut, for the application menu (ADR-054). */
export interface ExtensionShortcutItem {
  extensionId: string;
  extensionName: string;
  command: string;
  description: string;
  accelerator: string;
}

/** The extensions' shortcuts that are installed: valid, free (browser shortcuts win), four per extension at most. */
export function activeExtensionShortcuts(): ExtensionShortcutItem[] {
  const names = new Map(listExtensions().map((extension) => [extension.id, extension.name]));
  return appServices()
    .extensionApi.commandShortcuts()
    .flatMap((shortcut) =>
      shortcut.active && shortcut.accelerator
        ? [{ extensionId: shortcut.extensionId, extensionName: names.get(shortcut.extensionId) ?? "", command: shortcut.command, description: shortcut.description, accelerator: shortcut.accelerator }]
        : [],
    );
}

/** The window an extension shortcut runs in (a BrowserController). */
export interface ExtensionCommandWindow {
  readonly isPrivate: boolean;
  readonly window: BaseWindow;
  /** Presses the extension's toolbar button (its chrome UI knows where the button is). */
  activateExtension(id: string): void;
}

/**
 * An extension's shortcut was pressed (ADR-054): `_execute_action` (and MV2's `_execute_browser_action`
 * / `_execute_page_action`) presses its button; any other command fires `commands.onCommand`.
 * Never in a private window: extensions do not run there.
 */
export function runExtensionCommand(c: ExtensionCommandWindow, extensionId: string, command: string): void {
  if (c.isPrivate || !appServices().extensions.running(extensionId)) return;
  if (isExecuteAction(command)) c.activateExtension(extensionId);
  else appServices().extensionApi.runCommand(extensionId, command, c.window.id);
}

/** "Détails" of `browser://extensions`, with the extension's shortcuts and their conflicts. */
export function extensionDetailsWithShortcuts(id: string): ExtensionDetailsInfo | null {
  const details = extensions().detailsOf(id);
  if (!details) return null;
  const shortcuts = appServices()
    .extensionApi.commandShortcuts(id)
    .filter((shortcut) => shortcut.extensionId === id)
    .map(({ command, description, accelerator, active, issue }) => ({ command, description, accelerator, active, issue }));
  return { ...details, shortcuts };
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
