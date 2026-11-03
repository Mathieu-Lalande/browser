import { Channels } from "@shared/ipc";
import { isSpaceId } from "@shared/spaces";
import { readerArticle } from "../reader";
import { showTabMenu } from "../tab-menu";
import { MAX_QUERY_LENGTH } from "./limits";
import { bool, bounds, defineHandlers, handle, maxStr, num, on, oneOf, opt, str } from "./registry";

/** Tabs of the sender's window, named by id (TabManager ignores ids it does not own). */
export const tabHandlers = defineHandlers({
  // No input: the "Nouvel onglet" button, which reuses an empty start-page tab (BrowserController.newTab).
  [Channels.tabCreate]: on([opt(str)], (c, input) => (input === undefined ? c.newTab() : c.tabs.create(input))),
  [Channels.tabClose]: on([str], (c, tabId) => c.tabs.close(tabId)),
  [Channels.tabActivate]: on([str], (c, tabId) => c.tabs.activate(tabId)),
  [Channels.tabNavigate]: on([str, str], (c, tabId, input) => c.tabs.navigate(tabId, input)),
  [Channels.tabBack]: on([str], (c, tabId) => c.tabs.back(tabId)),
  [Channels.tabForward]: on([str], (c, tabId) => c.tabs.forward(tabId)),
  [Channels.tabReload]: on([str], (c, tabId) => c.tabs.reload(tabId)),
  [Channels.tabStop]: on([str], (c, tabId) => c.tabs.stop(tabId)),
  [Channels.tabTogglePin]: on([str], (c, tabId) => c.tabs.togglePin(tabId)),
  [Channels.tabMove]: on([str, num], (c, tabId, index) => c.tabs.move(tabId, index)),
  [Channels.tabToggleShields]: on([str], (c, tabId) => c.tabs.toggleShields(tabId)),
  [Channels.tabProceedHttp]: on([str], (c, tabId) => c.tabs.proceedHttp(tabId)),
  [Channels.permissionRespond]: on([str, str, bool, bool], (c, tabId, promptId, allow, remember) =>
    c.tabs.respondPermission(tabId, promptId, allow, remember),
  ),
  [Channels.tabContextMenu]: on([str], (c, tabId) => showTabMenu(c, tabId)),
  // Popup blocker notice: the renderer names the tab only, main keeps the blocked URL.
  [Channels.tabOpenBlockedPopup]: on([str], (c, tabId) => c.tabs.openBlockedPopup(tabId)),
  [Channels.tabDismissBlockedPopup]: on([str], (c, tabId) => c.tabs.dismissBlockedPopup(tabId)),
  [Channels.tabMoveToSpace]: on([str, isSpaceId], (c, tabId, spaceId) => c.spaces.moveTab(tabId, spaceId)),

  // Tab media and find in page (the find bar sends the query typed by the user).
  [Channels.tabToggleMute]: on([str], (c, tabId) => c.tabs.toggleMute(tabId)),
  [Channels.findQuery]: on([str, maxStr(MAX_QUERY_LENGTH), bool], (c, tabId, text, matchCase) => c.tabs.findQuery(tabId, text, matchCase)),
  [Channels.findStep]: on([str, bool], (c, tabId, forward) => c.tabs.findStep(tabId, forward)),
  [Channels.findClose]: on([str], (c, tabId) => c.tabs.closeFind(tabId)),
  // Tab hover preview (ADR-037): the chrome names what it hovers and where; main draws the card.
  [Channels.tabPreviewShow]: on(
    [oneOf("tab", "favorite"), maxStr(8192), bounds],
    (c, kind, id, anchor) => c.previews.show(kind === "tab" ? { kind, id } : { kind, url: id }, anchor),
    { from: "chrome" },
  ),
  [Channels.tabPreviewHide]: on([], (c) => c.previews.hide(), { from: "chrome" }),
  [Channels.readerArticle]: handle([str], (c, tabId) => readerArticle(c, tabId)),
});
