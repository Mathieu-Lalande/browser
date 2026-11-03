/** The part of a webContents the registry uses (its id, and when it goes away). */
export interface UiContents {
  readonly id: number;
  once(event: "destroyed", listener: () => void): unknown;
}

/**
 * The open browser windows, keyed by their chrome UI's webContents id, and every webContents that
 * runs the browser's own UI (chrome and overlay) → its window. The latter is the IPC sender
 * allow-list: tab pages are never registered, so their messages are refused.
 */
export class WindowRegistry<W> {
  private readonly windows = new Map<number, W>();
  private readonly uiOwners = new Map<number, W>();

  /** A new window: its chrome UI is registered as one of its UIs too. */
  add(chrome: UiContents, window: W): void {
    this.windows.set(chrome.id, window);
    this.registerUi(chrome, window);
  }

  /** A browser UI of `window` (chrome or overlay), until its webContents is destroyed. */
  registerUi(contents: UiContents, window: W): void {
    const { id } = contents;
    this.uiOwners.set(id, window);
    contents.once("destroyed", () => this.uiOwners.delete(id));
  }

  /** The window closed (its UIs leave the allow-list when their webContents go). */
  remove(chromeId: number): void {
    this.windows.delete(chromeId);
  }

  /** Window of a chrome UI webContents (not the overlay). */
  fromChrome(contentsId: number): W | undefined {
    return this.windows.get(contentsId);
  }

  /** Window of any browser UI webContents (chrome or overlay): the IPC sender check. */
  fromUi(contentsId: number): W | undefined {
    return this.uiOwners.get(contentsId);
  }

  get size(): number {
    return this.windows.size;
  }

  all(): W[] {
    return [...this.windows.values()];
  }
}
