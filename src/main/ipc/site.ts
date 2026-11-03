import { isExtensionId } from "@shared/extensions";
import { Channels } from "@shared/ipc";
import { isSiteName } from "@shared/site-info";
import { installFromFile, installFromFolder, listExtensions, removeExtension, setExtensionEnabled, setExtensionPrivateAllowed } from "../extensions";
import {
  allowThirdPartyCookies,
  clearAllSiteData,
  clearTabSiteData,
  isPermissionKind,
  listSiteData,
  removeSiteData,
  resetSitePermission,
  setSitePermissionFor,
  siteInfoFor,
} from "../site-info";
import { MAX_URL_LENGTH } from "./limits";
import { bool, bounds, defineHandlers, handle, handleUi, maxStr, on, str } from "./registry";

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
  // The profile's site data: never listed nor cleared from a private window.
  [Channels.siteDataList]: handle([], (c) => (c.isPrivate ? null : listSiteData())),
  [Channels.siteDataRemove]: handle([isSiteName], (c, site) => (c.isPrivate ? null : removeSiteData(site))),
  [Channels.siteDataClearAll]: handle([], (c) => (c.isPrivate ? null : clearAllSiteData())),
});

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
});
