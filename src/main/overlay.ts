import { join } from "node:path";
import { WebContentsView, type BaseWindow, type WebContents } from "electron";
import { Channels } from "@shared/ipc";
import { uiUrl } from "./app-protocol";
import { isPopover, type Bounds, type OverlayKind, type OverlayRequest } from "@shared/types";
import { uiSession } from "./ui-session";

interface OverlayHooks {
  /** The overlay page was created: it must be accepted as this window's UI by the IPC layer. */
  onCreated(contents: WebContents): void;
  /** Where focus goes when the overlay closes after an action: the active page, or the chrome UI. */
  focusTarget(): WebContents;
  chrome(): WebContents;
  /** What is visible below the overlay, bottom first, for the blurred backdrop. */
  backdrop(): { contents: WebContents; bounds: Bounds }[];
  /** The overlay closed, or now shows something else than the link peek: the peek goes (ADR-027). */
  dismissed?(): void;
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
  /** What is shown (while attached). */
  private kind: OverlayKind | null = null;
  /** A native view kept above the overlay page while it is open: the link peek's page (ADR-027). */
  private topView: WebContentsView | null = null;

  constructor(
    private readonly window: BaseWindow,
    private readonly hooks: OverlayHooks,
  ) {
    window.on("resize", () => this.layout());
  }

  get isOpen(): boolean {
    return this.attached;
  }

  /** What the overlay shows, null when closed. */
  get shown(): OverlayKind | null {
    return this.attached ? this.kind : null;
  }

  /**
   * Keeps `view` above the overlay page while it is open (null: none). The caller attaches and
   * removes the view itself; the overlay only keeps the stacking order when it raises itself.
   */
  setTopView(view: WebContentsView | null): void {
    this.topView = view;
    if (view && this.attached && !this.window.isDestroyed()) this.window.contentView.addChildView(view);
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
    // Anything else replacing the link peek (Ctrl+K…) takes its place.
    if (request.kind !== "link-peek") this.hooks.dismissed?.();
    this.kind = request.kind;
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
    this.kind = null;
    this.hooks.dismissed?.();
    const target = restoreFocus && this.returnFocus && !this.returnFocus.isDestroyed() ? this.returnFocus : this.hooks.focusTarget();
    this.returnFocus = null;
    if (!target.isDestroyed()) target.focus();
  }

  /** Keeps the overlay above the tab views (a newly attached tab view would cover it). */
  raise(): void {
    if (!this.view || this.window.isDestroyed()) return;
    const children = this.window.contentView.children;
    const top = this.topView;
    if (this.attached && (top ? children.at(-2) === this.view && children.at(-1) === top : children.at(-1) === this.view)) return;
    // Re-adding a child view moves it to the top.
    this.window.contentView.addChildView(this.view);
    if (top) this.window.contentView.addChildView(top);
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
        // Never a tab session: nothing installed there (extensions…) reaches the UI (ADR-024).
        session: uiSession(),
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
    void contents.loadURL(uiUrl("overlay"));
    this.view = view;
    return view;
  }
}
