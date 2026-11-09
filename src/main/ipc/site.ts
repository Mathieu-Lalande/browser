import { isExtensionId, MAX_DROPPED_FILES, MAX_DROPPED_SIZE, type DroppedExtension } from "@shared/extensions";
import { Channels } from "@shared/ipc";
import { isSiteName } from "@shared/site-info";
import {
  answerExtensionReview,
  extensionDetails,
  installDroppedExtension,
  openExtensionOptions,
  showInstalledExtension,
  storeInstalls,
  extensionReview,
  installFromFile,
  installFromFolder,
  installFromWebStore,
  listExtensions,
  openExtensionPopup,
  removeExtension,
  setExtensionEnabled,
  setExtensionPinned,
  setExtensionPrivateAllowed,
  showExtensionsMenu,
  updateExtensions,
  webStoreTestOrigin,
} from "../extensions";
import {
  allowThirdPartyCookies,
  clearAllSiteData,
  clearTabSiteData,
  isPermissionKind,
  listSiteData,
  removeSiteData,
  resetSitePermission,
  setCookieBannersFor,
  setSitePermissionFor,
  siteInfoFor,
} from "../site-info";
import { forgetSitePermissionDecision, listSiteSettings, resetSite, resetSiteZoom, setSiteShields, setSiteSwitch } from "../site-info/site-settings";
import { clearPrivacyStats, privacySummary } from "../privacy";
import { isSiteListSetting } from "@shared/site-settings";
import { MAX_URL_LENGTH } from "./limits";
import { bool, bounds, custom, defineHandlers, handle, handleUi, maxStr, nullable, on, str } from "./registry";

/**
 * Site info popover (ADR-021): the UI names a tab of its own window; main reads its URL and
 * session. Origins are only used as lookup keys in the tab's permission store.
 */
export const siteInfoHandlers = defineHandlers({
  [Channels.siteInfoShow]: on([bounds], (c, anchor) => c.showSiteInfo(anchor)),
  [Channels.siteInfoGet]: handle([str], (c, tabId) => siteInfoFor(c, tabId)),
  [Channels.siteInfoResetPermission]: handle([str, maxStr(MAX_URL_LENGTH), isPermissionKind], (c, tabId, origin, kind) =>
    resetSitePermission(c, tabId, origin, kind),
  ),
  [Channels.siteInfoSetPermission]: handle([str, maxStr(MAX_URL_LENGTH), isPermissionKind, bool], (c, tabId, origin, kind, allow) =>
    setSitePermissionFor(c, tabId, origin, kind, allow),
  ),
  [Channels.siteInfoClearData]: handle([str], (c, tabId) => clearTabSiteData(c, tabId)),
  [Channels.siteInfoAllowThirdPartyCookies]: handle([str, bool], (c, tabId, allow) => allowThirdPartyCookies(c, tabId, allow)),
  [Channels.siteInfoSetCookieBanners]: handle([str, bool], (c, tabId, enabled) => setCookieBannersFor(c, tabId, enabled)),
  // The profile's site data: never listed nor cleared from a private window.
  [Channels.siteDataList]: handle([], (c) => (c.isPrivate ? null : listSiteData())),
  [Channels.siteDataRemove]: handle([isSiteName], (c, site) => (c.isPrivate ? null : removeSiteData(site))),
  [Channels.siteDataClearAll]: handle([], (c) => (c.isPrivate ? null : clearAllSiteData())),
});

/**
 * ADR-046: the privacy dashboard and `browser://site-settings`. Both show the profile's data; a
 * private window may look, not change (its own decisions live in memory and go with it).
 */
export const privacyPageHandlers = defineHandlers({
  [Channels.privacyStatsSummary]: handle([nullable(isSiteName)], (_c, site) => privacySummary(site)),
  [Channels.privacyStatsClear]: handle([nullable(isSiteName)], (c, site) => {
    if (c.isPrivate) return null;
    clearPrivacyStats(site);
    return privacySummary(null);
  }),
  [Channels.siteSettingsList]: handle([], () => listSiteSettings()),
  [Channels.siteSettingsSetSwitch]: handle([isSiteName, isSiteListSetting, bool], (c, site, key, value) => (c.isPrivate ? null : setSiteSwitch(site, key, value))),
  [Channels.siteSettingsSetShields]: handle([isSiteName, bool], (c, host, enabled) => (c.isPrivate ? null : setSiteShields(host, enabled))),
  [Channels.siteSettingsResetZoom]: handle([isSiteName], (c, host) => (c.isPrivate ? null : resetSiteZoom(host))),
  [Channels.siteSettingsForgetPermission]: handle([maxStr(MAX_URL_LENGTH), isPermissionKind, maxStr(MAX_URL_LENGTH)], (c, origin, kind, topOrigin) =>
    c.isPrivate ? null : forgetSitePermissionDecision(origin, kind, topOrigin),
  ),
  [Channels.siteSettingsReset]: handle([isSiteName], (c, site) => (c.isPrivate ? null : resetSite(site))),
});

const bytes = (value: unknown): value is Uint8Array => value instanceof Uint8Array && value.length <= MAX_DROPPED_SIZE;

/** A dropped package: bytes only (never a path), bounded like a picked file. */
function isDroppedExtension(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const dropped = value as Record<string, unknown>;
  if (dropped.kind === "file") return maxStr(260)(dropped.name) && bytes(dropped.data);
  if (dropped.kind !== "folder" || !Array.isArray(dropped.files) || dropped.files.length > MAX_DROPPED_FILES) return false;
  return dropped.files.every((file: unknown) => {
    const entry = file as Record<string, unknown> | null;
    return typeof entry === "object" && entry !== null && maxStr(1024)(entry.path) && bytes(entry.data);
  });
}
const droppedExtension = custom<DroppedExtension>(isDroppedExtension);
const privateRefusal = { ok: false, message: "Les extensions se gèrent depuis une fenêtre normale." } as const;

/**
 * Extensions (ADR-024): the UI names them by id; folders and files are picked in main's dialogs.
 * Installed in the profile: a private window may list them, not change them.
 */
export const extensionHandlers = defineHandlers({
  [Channels.extensionsList]: handleUi([], () => listExtensions()),
  [Channels.extensionsInstallFolder]: handle([], (c) => (c.isPrivate ? privateRefusal : installFromFolder(c.window))),
  [Channels.extensionsInstallFile]: handle([], (c) => (c.isPrivate ? privateRefusal : installFromFile(c.window))),
  [Channels.extensionsSetEnabled]: handle([isExtensionId, bool], (c, extensionId, enabled) =>
    c.isPrivate ? undefined : setExtensionEnabled(extensionId, enabled),
  ),
  [Channels.extensionsSetPrivateAllowed]: handle([isExtensionId, bool], (c, extensionId, allowed) =>
    c.isPrivate ? undefined : setExtensionPrivateAllowed(extensionId, allowed),
  ),
  [Channels.extensionsRemove]: handle([isExtensionId], (c, extensionId) => (c.isPrivate ? undefined : removeExtension(extensionId))),
  // ADR-049: Chrome Web Store, updates, toolbar buttons and popups (no extension runs in a private window).
  [Channels.extensionsSetPinned]: handle([isExtensionId, bool], (c, extensionId, pinned) => (c.isPrivate ? undefined : setExtensionPinned(extensionId, pinned))),
  [Channels.extensionsInstallFromStore]: handle([isExtensionId], (c, webStoreId) => (c.isPrivate ? privateRefusal : installFromWebStore(c, webStoreId))),
  [Channels.extensionsCheckUpdates]: handle([], (c) => (c.isPrivate ? privateRefusal : updateExtensions(c))),
  [Channels.extensionsStoreOrigin]: handleUi([], () => webStoreTestOrigin()),
  [Channels.extensionsReview]: handleUi([maxStr(64)], (reviewId) => extensionReview(reviewId)),
  [Channels.extensionsAnswerReview]: on([maxStr(64), bool], (_c, reviewId, accepted) => answerExtensionReview(reviewId, accepted)),
  [Channels.extensionsOpenPopup]: on([isExtensionId, bounds], (c, extensionId, anchor) => openExtensionPopup(c, extensionId, anchor), { privateRefused: true }),
  [Channels.extensionsMenu]: on([nullable(isExtensionId), bounds], (c, extensionId, anchor) => showExtensionsMenu(c, extensionId, anchor), { privateRefused: true }),
  [Channels.extensionsStoreInstalls]: handleUi([], () => storeInstalls()),
  [Channels.extensionsDetails]: handleUi([isExtensionId], (extensionId) => extensionDetails(extensionId)),
  [Channels.extensionsOpenOptions]: handle([isExtensionId], (c, extensionId) => !c.isPrivate && openExtensionOptions(c, extensionId)),
  [Channels.extensionsInstallDropped]: handle([droppedExtension], (c, dropped) => (c.isPrivate ? privateRefusal : installDroppedExtension(c, dropped))),
  [Channels.extensionsShowInstalled]: on([isExtensionId, bounds], (c, extensionId, anchor) => showInstalledExtension(c, extensionId, anchor), { privateRefused: true }),
});
