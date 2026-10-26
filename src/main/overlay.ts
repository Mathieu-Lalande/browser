import { join } from "node:path";
import { WebContentsView, type BaseWindow, type WebContents } from "electron";
import { Channels } from "@shared/ipc";
import { isPopover, type Bounds, type OverlayRequest } from "@shared/types";

interface OverlayHooks {
  /** The overlay page was created: it must be accepted as this window's UI by the IPC layer. */
  onCreated(contents: WebContents): void;
  /** Where focus goes when the overlay closes after an action: the active page, or the chrome UI. */
  focusTarget(): WebContents;
  chrome(): WebContents;
  /** What is visible below the overlay, bottom first, for the blurred backdrop. */
  backdrop(): { contents: WebContents; bounds: Bounds }[];
}

/** Backdrop snapshots are downscaled this much (they are blurred anyway). */
const BACKDROP_SCALE = 4;

/**
 * The overlay layer: one transparent WebContentsView per window, stacked above the tab views,
 * that renders floating UI (the command palette) which the chrome UI cannot draw over native
 * page views. It runs the renderer bundle's `overlay.html` entry with the chrome's preload.
 *
 * Created lazily and pre-warmed once the window is shown, then kept loaded: opening only
 * attaches the view and focuses it, closing detaches it, so the page receives input again.
 */
export class Overlay {
  private view: WebContentsView | null = null;
  private attached = false;
  /** What had keyboard focus when the overlay opened, restored on cancel. */
  private returnFocus: WebContents | null = null;
  /** The overlay page finished loading and listens for requests. */
  private ready = false;
  private pending: OverlayRequest | null = null;
  /** Counts openings, so a late backdrop is not sent to a later one. */
  private openings = 0;

  constructor(
    private readonly window: BaseWindow,
    private readonly hooks: OverlayHooks,
  ) {
    window.on("resize", () => this.layout());
  }

  get isOpen(): boolean {
    return this.attached;
  }

  /** Creates and loads the overlay page ahead of time, so the first open is instant. */
  warm(): void {
    this.ensureView();
  }

  open(request: OverlayRequest): void {
    if (this.window.isDestroyed()) return;
    const view = this.ensureView();
    const chrome = this.hooks.chrome();
    const opening = !this.attached;
    if (opening) this.returnFocus = chrome.isFocused() ? chrome : this.hooks.focusTarget();
    // The page renders the request while being attached: no visible delay. Before its first
    // load completes (opened right at startup), the request waits for it.
    if (this.ready) view.webContents.send(Channels.overlayShow, request);
    else this.pending = request;
    this.raise();
    view.webContents.focus();
    if (opening) this.openings++;
    if (opening && !isPopover(request.kind)) void this.sendBackdrop(this.openings);
  }

  /**
   * Sends a small snapshot of the window below, which the overlay blurs behind its scrim.
   * Measured at ~10 ms capture + ~4 ms encode per layer: done after opening, never delaying it,
   * and the overlay fades it in when it arrives.
   */
  private async sendBackdrop(opening: number): Promise<void> {
    try {
      const layers = await Promise.all(
        this.hooks.backdrop().map(async ({ contents, bounds }) => {
          const image = await contents.capturePage();
          const { width } = image.getSize();
          // A blurred background needs few pixels: a quarter-size JPEG is a few KB.
          const small = image.resize({ width: Math.max(1, Math.round(width / BACKDROP_SCALE)), quality: "good" });
          return { image: `data:image/jpeg;base64,${small.toJPEG(70).toString("base64")}`, bounds };
        }),
      );
      if (opening === this.openings && this.attached) this.send(Channels.overlayBackdrop, { layers });
    } catch {
      // Purely cosmetic: the translucent scrim alone is fine.
    }
  }

  toggle(request: OverlayRequest): void {
    if (this.attached) this.close(true);
    else this.open(request);
  }

  /** `restoreFocus`: give focus back to what had it before opening (cancel), else to `focusTarget`. */
  close(restoreFocus = false): void {
    if (!this.attached || !this.view) return;
    this.window.contentView.removeChildView(this.view);
    this.attached = false;
    const target = restoreFocus && this.returnFocus && !this.returnFocus.isDestroyed() ? this.returnFocus : this.hooks.focusTarget();
    this.returnFocus = null;
    if (!target.isDestroyed()) target.focus();
  }

  /** Keeps the overlay above the tab views (a newly attached tab view would cover it). */
  raise(): void {
    if (!this.view || this.window.isDestroyed()) return;
    if (this.attached && this.window.contentView.children.at(-1) === this.view) return;
    // Re-adding a child view moves it to the top.
    this.window.contentView.addChildView(this.view);
    this.attached = true;
    this.layout();
  }

  /** Pushes a message to the overlay page, if it exists (browser state…). */
  send(channel: string, ...args: unknown[]): void {
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.send(channel, ...args);
  }

  destroy(): void {
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.view = null;
    this.attached = false;
  }

  private layout(): void {
    if (!this.view || !this.attached || this.window.isDestroyed()) return;
    const { width, height } = this.window.getContentBounds();
    this.view.setBounds({ x: 0, y: 0, width, height });
  }

  private ensureView(): WebContentsView {
    if (this.view) return this.view;
    const view = new WebContentsView({
      webPreferences: {
        preload: join(import.meta.dirname, "../preload/index.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    // Fully transparent: the page stays visible behind the overlay's scrim.
    view.setBackgroundColor("#00000000");
    const contents = view.webContents;
    this.hooks.onCreated(contents);
    // Like the chrome UI, a fixed app page: it never navigates nor opens windows.
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.once("did-finish-load", () => {
      this.ready = true;
      if (this.pending && this.attached) contents.send(Channels.overlayShow, this.pending);
      this.pending = null;
    });
    if (process.env.ELECTRON_RENDERER_URL) void contents.loadURL(`${process.env.ELECTRON_RENDERER_URL}/overlay.html`);
    else void contents.loadFile(join(import.meta.dirname, "../renderer/overlay.html"));
    this.view = view;
    return view;
  }
}
