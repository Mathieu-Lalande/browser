import type { Bounds, BrowserState, TabId, UiCommand } from "./types";

/** IPC channel names, shared by main and preload so they cannot drift. */
export const Channels = {
  getState: "browser:get-state",
  state: "browser:state",
  uiCommand: "browser:ui-command",
  tabCreate: "tab:create",
  tabClose: "tab:close",
  tabActivate: "tab:activate",
  tabNavigate: "tab:navigate",
  tabBack: "tab:back",
  tabForward: "tab:forward",
  tabReload: "tab:reload",
  tabStop: "tab:stop",
  tabTogglePin: "tab:toggle-pin",
  tabMove: "tab:move",
  layoutBounds: "layout:bounds",
  windowMinimize: "window:minimize",
  windowToggleMaximize: "window:toggle-maximize",
  windowClose: "window:close",
} as const;

/** API exposed to the chrome UI on `window.browser` by the preload script. */
export interface BrowserApi {
  getState(): Promise<BrowserState>;
  onState(listener: (state: BrowserState) => void): () => void;
  onUiCommand(listener: (command: UiCommand) => void): () => void;
  tabs: {
    create(input?: string): void;
    close(id: TabId): void;
    activate(id: TabId): void;
    navigate(id: TabId, input: string): void;
    back(id: TabId): void;
    forward(id: TabId): void;
    reload(id: TabId): void;
    stop(id: TabId): void;
    togglePin(id: TabId): void;
    move(id: TabId, toIndex: number): void;
  };
  layout: {
    setContentBounds(bounds: Bounds): void;
  };
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
  };
}
