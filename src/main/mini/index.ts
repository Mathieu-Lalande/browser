import type { IpcMain, WebContents } from "electron";
import { Channels } from "@shared/ipc";
import { MINI_ACTIONS } from "@shared/mini";
import { oneOf, validArgs } from "../ipc/registry";
import { MiniWindow, type MiniHost } from "./mini-window";

export { MiniWindow, type MiniHost } from "./mini-window";

/**
 * The open mini windows (ADR-048). Their bars are browser UI pages, but not a browser window's:
 * they get their own IPC sender check here (only a known bar, one validated action).
 */
export class MiniWindows {
  private readonly open = new Set<MiniWindow>();

  constructor(private readonly host: Omit<MiniHost, "closed">) {}

  /** Shows `url` (a web link from another app) in a new mini window. */
  show(url: string): MiniWindow {
    const mini = new MiniWindow(url, { ...this.host, closed: (closed) => this.open.delete(closed) });
    this.open.add(mini);
    return mini;
  }

  all(): MiniWindow[] {
    return [...this.open];
  }

  /** The mini window whose bar is `contents`. */
  fromBar(contents: WebContents): MiniWindow | undefined {
    return this.all().find((mini) => !mini.bar.webContents.isDestroyed() && mini.bar.webContents.id === contents.id);
  }

  /** Settings or the OS theme changed. */
  refreshAll(): void {
    for (const mini of this.open) mini.refresh();
  }

  registerIpc(ipc: Pick<IpcMain, "on">): void {
    const actions = [oneOf(...MINI_ACTIONS)] as const;
    ipc.on(Channels.miniAction, (event, ...args) => {
      const mini = this.fromBar(event.sender);
      if (mini && validArgs(actions, args)) mini.act(args[0] as (typeof MINI_ACTIONS)[number]);
    });
  }
}
