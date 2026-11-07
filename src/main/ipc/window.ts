import { isCommandId } from "@shared/commands";
import { Channels } from "@shared/ipc";
import { isPeekAction } from "@shared/peek";
import { MAX_COPY_LENGTH, OPEN_DISPOSITIONS } from "@shared/omnibox/types";
import { isSpaceId } from "@shared/spaces";
import { runCommand } from "../commands";
import { showSidebarMenu } from "../context-menus";
import { showAppMenu } from "../page-actions";
import { omniboxCopy, omniboxOpen, omniboxTabs } from "../omnibox";
import { MAX_URL_LENGTH } from "./limits";
import { bool, bounds, defineHandlers, handle, num, on, oneOf, opt, str, text, wheelSample } from "./registry";

/** The window itself: state, layout, split view, frame buttons, command palette, overlay and peek. */
export const windowHandlers = defineHandlers({
  [Channels.getState]: handle([], (c) => c.getState(), { fallback: null }),

  [Channels.splitOpen]: on([str], (c, tabId) => c.tabs.openSplit(tabId)),
  [Channels.splitExit]: on([], (c) => c.tabs.exitSplit()),
  [Channels.splitRatios]: on([num, num], (c, x, y) => c.tabs.setSplitRatios(x, y)),
  [Channels.layoutBounds]: on([bounds], (c, area) => {
    c.spaces.setBounds(area);
    c.peek.layout();
  }),

  [Channels.windowMinimize]: on([], (c) => c.window.minimize()),
  [Channels.windowToggleMaximize]: on([], (c) => (c.window.isMaximized() ? c.window.unmaximize() : c.window.maximize())),
  [Channels.windowClose]: on([], (c) => c.window.close()),
  [Channels.windowIsMaximized]: handle([], (c) => c.window.isMaximized(), { from: "chrome", fallback: false }),
  [Channels.windowTopBar]: on([num], (c, height) => c.watchTopBar(height), { from: "chrome" }),

  // Command palette: registry commands and the overlay layer.
  [Channels.commandRun]: on([isCommandId], (c, commandId) => runCommand(commandId, c)),
  // Universal bar (ADR-032): typed text goes through normalizeInput like the address bar's.
  [Channels.omniboxTabs]: handle([], (c) => omniboxTabs(c), { fallback: [] }),
  [Channels.omniboxShowTab]: on([isSpaceId, str], (c, spaceId, tabId) => c.spaces.showTab(spaceId, tabId)),
  [Channels.omniboxOpen]: on([text(MAX_URL_LENGTH), oneOf(...OPEN_DISPOSITIONS)], (c, input, disposition) => omniboxOpen(c, input, disposition)),
  [Channels.omniboxCopy]: on([text(MAX_COPY_LENGTH)], (_c, value) => omniboxCopy(value)),
  [Channels.overlayClose]: on([opt(bool)], (c, restoreFocus) => c.overlay.close(restoreFocus)),
  [Channels.tabOverviewShow]: on([], (c) => c.overlay.open({ kind: "tab-overview" })),
  // App menu, sidebar menu and page gestures (ADR-033).
  [Channels.appMenuShow]: on([bounds], (c, anchor) => showAppMenu(c, anchor), { from: "chrome" }),
  [Channels.sidebarContextMenu]: on([], (c) => showSidebarMenu(c), { from: "chrome" }),
  [Channels.pageSwipeWheel]: on([wheelSample], (c, sample) => c.gestures.feedOverlay(sample)),
  // Link peek (ADR-027): the overlay names an action only; main knows the page and its URL.
  [Channels.peekAction]: on([isPeekAction], (c, action) => c.peek.act(action)),
});
