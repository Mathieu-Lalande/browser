import { isCommandId } from "@shared/commands";
import { Channels } from "@shared/ipc";
import { isPeekAction } from "@shared/peek";
import { runCommand } from "../commands";
import { bool, bounds, defineHandlers, handle, num, on, opt, str } from "./registry";

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

  // Command palette: registry commands and the overlay layer.
  [Channels.commandRun]: on([isCommandId], (c, commandId) => runCommand(commandId, c)),
  [Channels.overlayClose]: on([opt(bool)], (c, restoreFocus) => c.overlay.close(restoreFocus)),
  // Link peek (ADR-027): the overlay names an action only; main knows the page and its URL.
  [Channels.peekAction]: on([isPeekAction], (c, action) => c.peek.act(action)),
});
