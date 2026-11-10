import { WebContentsView, type BaseWindow, type Session, type WebContents } from "electron";
import { isPageOpenableUrl } from "@shared/url";
import type { Bounds } from "@shared/types";
import type { Overlay } from "../overlay";

/** What an extension popup needs from its window (a BrowserController). */
export interface ExtensionPopupHost {
  readonly window: BaseWindow;
  readonly overlay: Overlay;
  /** The session of the pages on screen: the popup runs in the extension's copy there. */
  session(): Session;
  /** A link the popup opens: a new tab of the window. */
  openTab(url: string): void;
}

/** Chrome's popup size limits. */
const MIN_SIZE = 25;
const MAX_WIDTH = 800;
const MAX_HEIGHT = 600;
/** Until the page has been measured (or when it cannot be). */
const FALLBACK_SIZE = { width: 320, height: 240 };
/** Popups often render after loading (frameworks, storage reads): measured again this often while open. */
const MEASURE_EVERY_MS = 400;
/** Isolated world of the size probe (ADR-049): never the extension's own JavaScript world. */
const MEASURE_WORLD = 1021;
/**
 * The page's natural size: the root laid out at its max-content width for an instant (no paint
 * happens in between), as Chrome sizes popups to their content.
 */
const MEASURE_SCRIPT = `(() => {
  const root = document.documentElement;
  if (!root || !document.body) return null;
  const previous = root.style.getPropertyValue("width");
  const priority = root.style.getPropertyPriority("width");
  root.style.setProperty("width", "max-content", "important");
  const box = root.getBoundingClientRect();
  if (previous) root.style.setProperty("width", previous, priority);
  else root.style.removeProperty("width");
  return { width: Math.ceil(box.width), height: Math.ceil(box.height) };
})()`;
const GAP = 6;
const MARGIN = 8;
const RADIUS = 10;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * An extension's popup (`action.default_popup`, ADR-049): a WebContentsView of its own, in the
 * session of the window's pages (where the extension is loaded), loading its `chrome-extension://`
 * page, sized to its content (measured in an isolated world, within Chrome's 800×600). It hangs below the
 * toolbar button, above the overlay layer, which only catches clicks outside it (they close it, as
 * Escape and `window.close()` do). Links it opens become tabs; it never navigates elsewhere.
 */
export class ExtensionPopup {
  private view: WebContentsView | null = null;
  private anchor: Bounds = { x: 0, y: 0, width: 0, height: 0 };
  private size: { width: number; height: number } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly host: ExtensionPopupHost) {}

  get isOpen(): boolean {
    return this.view !== null;
  }

  /** The open popup's page (the extension API bridge places its calls in this window, ADR-053). */
  get contents(): Electron.WebContents | null {
    return this.view?.webContents ?? null;
  }

  /** Opens `url` (from `ExtensionService.popupUrl`) below `anchor`, replacing any open popup. */
  open(url: string, anchor: Bounds): void {
    if (this.host.window.isDestroyed()) return;
    this.close();
    // The overlay first: opening it dismisses whatever floated before (this popup included).
    this.host.overlay.open({ kind: "extension-popup", anchor });
    const view = new WebContentsView({
      webPreferences: {
        session: this.host.session(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: true,
      },
    });
    view.setBorderRadius(RADIUS);
    view.setBackgroundColor("#ffffff");
    this.view = view;
    this.anchor = anchor;
    this.size = null;
    this.wire(view.webContents, new URL(url).origin);
    this.host.window.contentView.addChildView(view);
    this.host.overlay.setTopView(view);
    this.layout();
    view.webContents.focus();
    void view.webContents.loadURL(url).catch(() => {
      // An unloadable popup shows Chromium's error page in the box.
    });
  }

  /** Closes the popup (and the overlay's click catcher). */
  close(): void {
    const view = this.view;
    if (!view) return;
    this.view = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.host.overlay.setTopView(null);
    if (!this.host.window.isDestroyed() && this.host.window.contentView.children.includes(view)) this.host.window.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
    if (this.host.overlay.shown === "extension-popup") this.host.overlay.close(true);
  }

  private layout(): void {
    if (!this.view || this.host.window.isDestroyed()) return;
    const { width: windowWidth, height: windowHeight } = this.host.window.getContentBounds();
    const wanted = this.size ?? FALLBACK_SIZE;
    const top = this.anchor.y + this.anchor.height + GAP;
    const width = clamp(wanted.width, MIN_SIZE, Math.min(MAX_WIDTH, windowWidth - 2 * MARGIN));
    const height = clamp(wanted.height, MIN_SIZE, Math.min(MAX_HEIGHT, windowHeight - top - MARGIN));
    const x = clamp(this.anchor.x, MARGIN, windowWidth - width - MARGIN);
    this.view.setBounds({ x: Math.round(x), y: Math.round(top), width: Math.round(width), height: Math.round(height) });
  }

  private async measure(contents: WebContents): Promise<void> {
    if (this.view?.webContents !== contents || contents.isDestroyed()) return;
    const size = (await contents.executeJavaScriptInIsolatedWorld(MEASURE_WORLD, [{ code: MEASURE_SCRIPT }]).catch(() => null)) as {
      width: number;
      height: number;
    } | null;
    if (!size || this.view?.webContents !== contents || (size.width === this.size?.width && size.height === this.size?.height)) return;
    this.size = size;
    this.layout();
  }

  private wire(contents: WebContents, origin: string): void {
    // Electron's preferred-size events do not reach a WebContentsView: the page is measured instead.
    contents.on("did-finish-load", () => {
      void this.measure(contents);
      this.timer ??= setInterval(() => void this.measure(contents), MEASURE_EVERY_MS);
    });
    // Links (target=_blank, window.open) become tabs; the popup itself stays on its extension.
    contents.setWindowOpenHandler(({ url }) => {
      if (isPageOpenableUrl(url)) {
        this.host.openTab(url);
        this.close();
      }
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (url.startsWith(`${origin}/`)) return;
      event.preventDefault();
      if (isPageOpenableUrl(url)) {
        this.host.openTab(url);
        this.close();
      }
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && input.key === "Escape" && !input.control && !input.meta && !input.alt && !input.shift) {
        event.preventDefault();
        this.close();
      }
    });
    // The popup closed itself (`window.close()`), or crashed.
    contents.on("destroyed", () => {
      if (this.view?.webContents === contents) this.close();
    });
    contents.on("render-process-gone", () => {
      if (this.view?.webContents === contents) this.close();
    });
  }
}
