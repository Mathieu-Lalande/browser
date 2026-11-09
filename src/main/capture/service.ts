import { t } from "@shared/i18n";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ClipboardItem, clipboard, dialog, nativeImage, screen, type NativeImage, type WebContents } from "electron";
import { captureFileName, captureScale, elementClip, fullPageClip, isCaptureRect, type CaptureMode, type CaptureRect } from "@shared/capture";
import type { Bounds } from "@shared/types";
import type { WindowDirectory, WindowPort } from "../ports";
import { TabRecorder } from "./recorder";
import { PICK_SCRIPT, PICK_WORLD_ID } from "./scripts";

interface Kept {
  image: NativeImage;
  name: string;
  owner: WindowPort;
}

type Send = (method: string, params?: object) => Promise<unknown>;

/** Previews fit this box (the popover shows them small). */
const PREVIEW = { width: 320, height: 240 };

export interface CaptureServiceDeps {
  windows: WindowDirectory;
  /** Where saved captures and recordings are offered (the downloads folder). */
  downloadsFolder: () => string;
  /** The densest display's scale factor (default: every display's, from Electron's `screen`). */
  displayScale?: () => number;
}

/** The size of a capture's preview: within `PREVIEW`, never scaled up. */
export function previewSize({ width, height }: { width: number; height: number }): { width: number; height: number } {
  const scale = Math.min(1, PREVIEW.width / width, PREVIEW.height / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Runs DevTools protocol commands on the page, attaching the debugger only if no capture did. */
async function withDebugger<T>(contents: WebContents, run: (send: Send) => Promise<T>): Promise<T> {
  const client = contents.debugger;
  const owned = !client.isAttached();
  if (owned) client.attach("1.3");
  try {
    return await run((method, params) => client.sendCommand(method, params));
  } finally {
    if (owned && client.isAttached()) client.detach();
  }
}

/**
 * Screenshots and tab recording (ADR-031). Visible area: `capturePage`. Whole page and element: the
 * DevTools protocol (`Page.captureScreenshot` with `captureBeyondViewport`) through
 * `webContents.debugger`, attached for the capture only (a user's DevTools are a separate client
 * and stay open). The image stays here: the overlay gets a small preview and acts on it by id.
 * Nothing is recorded anywhere (private windows included) until the user saves it.
 */
export class CaptureService {
  readonly recorder: TabRecorder;
  /** One result per window: a new capture replaces the previous one. */
  private readonly results = new Map<string, Kept>();
  private readonly busy = new WeakSet<WebContents>();
  private readonly watched = new WeakSet<WindowPort>();
  private readonly displayScale: () => number;

  constructor(private readonly deps: CaptureServiceDeps) {
    this.recorder = new TabRecorder(deps);
    this.displayScale = deps.displayScale ?? (() => Math.max(1, ...screen.getAllDisplays().map((display) => display.scaleFactor)));
  }

  /**
   * The capture scale of a clip: huge pages are scaled down so the bitmap stays within
   * MAX_CAPTURE_PIXELS (memory). Device pixel ratio: the densest display (conservative), times the page's zoom.
   */
  scaleFor(clip: CaptureRect, zoomFactor: number): number {
    return captureScale(clip, Math.max(1, this.displayScale()) * zoomFactor);
  }

  /** Takes a screenshot of the active tab, then shows the result popover. */
  async capture(c: WindowPort, mode: CaptureMode): Promise<void> {
    const page = this.activePage(c);
    if (!page || this.busy.has(page.contents)) return;
    this.busy.add(page.contents);
    // The page gets the input back (element picker), and the overlay is not in the way.
    c.overlay.close();
    let image: NativeImage | null = null;
    try {
      image = await this.take(mode, page.contents);
    } catch (error) {
      console.warn("Capture:", error);
    } finally {
      this.busy.delete(page.contents);
    }
    if (!image || image.isEmpty() || c.window.isDestroyed()) return;
    this.forget(c);
    if (!this.watched.has(c)) {
      this.watched.add(c);
      c.window.once("closed", () => this.forget(c));
    }
    const id = randomUUID();
    this.results.set(id, { image, name: captureFileName(page.url, new Date()), owner: c });
    const { width, height } = image.getSize();
    const small = image.resize({ ...previewSize({ width, height }), quality: "good" });
    c.overlay.open({ kind: "capture-result", capture: { id, width, height, preview: `data:image/jpeg;base64,${small.toJPEG(82).toString("base64")}` } });
  }

  async copy(c: WindowPort, id: string): Promise<boolean> {
    const kept = this.resultOf(c, id);
    if (!kept) return false;
    try {
      await clipboard.write([new ClipboardItem({ "image/png": new Blob([kept.image.toPNG()], { type: "image/png" }) })]);
      return true;
    } catch {
      return false;
    }
  }

  async save(c: WindowPort, id: string): Promise<boolean> {
    const kept = this.resultOf(c, id);
    if (!kept) return false;
    const { canceled, filePath } = await dialog.showSaveDialog(c.window, {
      title: t("captureService.saveScreenshot"),
      defaultPath: join(this.deps.downloadsFolder(), kept.name),
      filters: [{ name: t("captureService.pngImage"), extensions: ["png"] }],
    });
    if (canceled || !filePath) return false;
    try {
      await writeFile(filePath, kept.image.toPNG());
      return true;
    } catch {
      return false;
    }
  }

  discard(c: WindowPort, id: string): void {
    if (this.resultOf(c, id)) this.results.delete(id);
  }

  /** Page options popover (ADR-031): below the address bar, else at the top-left corner of the page. */
  showPageOptions(c: WindowPort, anchor?: Bounds): void {
    const tabId = c.tabs.activeTabId;
    const tab = c.tabs.getState().tabs.find((item) => item.id === tabId);
    if (!tab?.url) return;
    const { x, y } = c.tabs.viewBounds;
    c.overlay.open({ kind: "page-options", tabId: tab.id, anchor: anchor ?? { x: x + 8, y, width: 0, height: 0 } });
  }

  private take(mode: CaptureMode, contents: WebContents): Promise<NativeImage | null> {
    switch (mode) {
      case "visible":
        return contents.capturePage();
      case "full":
        return withDebugger(contents, async (send) => {
          const metrics = (await send("Page.getLayoutMetrics")) as { cssContentSize: { width: number; height: number } };
          return this.screenshot(send, fullPageClip(metrics.cssContentSize), contents);
        });
      case "element":
        return this.pickElement(contents);
    }
  }

  private async pickElement(contents: WebContents): Promise<NativeImage | null> {
    contents.focus();
    const picked: unknown = await contents.executeJavaScriptInIsolatedWorld(PICK_WORLD_ID, [{ code: PICK_SCRIPT }], true).catch(() => null);
    if (typeof picked !== "object" || picked === null) return null;
    const { rect, page } = picked as { rect?: unknown; page?: unknown };
    if (!isCaptureRect(rect) || !isCaptureRect({ x: 0, y: 0, ...(page as object) })) return null;
    const clip = elementClip(rect, page as { width: number; height: number });
    return clip && !contents.isDestroyed() ? withDebugger(contents, (send) => this.screenshot(send, clip, contents)) : null;
  }

  private async screenshot(send: Send, clip: CaptureRect, contents: WebContents): Promise<NativeImage> {
    const scale = this.scaleFor(clip, contents.getZoomFactor());
    const { data } = (await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...clip, scale } })) as { data: string };
    return nativeImage.createFromBuffer(Buffer.from(data, "base64"));
  }

  /** The active tab's page, when it shows a web page (internal pages are drawn by the UI). */
  private activePage(c: WindowPort): { contents: WebContents; url: string } | null {
    const tabId = c.tabs.activeTabId;
    const tab = c.tabs.getState().tabs.find((item) => item.id === tabId);
    const contents = tabId ? c.tabs.pageOf(tabId) : null;
    if (!tab || !contents || contents.isDestroyed() || !/^(https?|file):/.test(tab.url) || tab.interstitial) return null;
    return { contents, url: tab.url };
  }

  private resultOf(c: WindowPort, id: string): Kept | undefined {
    const kept = this.results.get(id);
    return kept?.owner === c ? kept : undefined;
  }

  private forget(c: WindowPort): void {
    for (const [id, kept] of this.results) if (kept.owner === c) this.results.delete(id);
  }
}
