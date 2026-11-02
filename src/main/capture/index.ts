import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ClipboardItem, clipboard, dialog, nativeImage, type NativeImage, type WebContents } from "electron";
import { captureFileName, elementClip, fullPageClip, isCaptureRect, type CaptureMode, type CaptureRect } from "@shared/capture";
import type { Bounds } from "@shared/types";
import { downloadsFolder } from "../downloads";
import type { BrowserController } from "../window";
import { PICK_SCRIPT, PICK_WORLD_ID } from "./scripts";

/**
 * Screenshots (ADR-031). Visible area: `capturePage`. Whole page and element: the DevTools
 * protocol (`Page.captureScreenshot` with `captureBeyondViewport`) through `webContents.debugger`,
 * attached for the capture only (a user's DevTools are a separate client and stay open).
 * The image stays here: the overlay gets a small preview and acts on it by id. Nothing is
 * recorded anywhere (private windows included) until the user saves it.
 */

interface Kept {
  image: NativeImage;
  name: string;
  owner: BrowserController;
}

/** One result per window: a new capture replaces the previous one. */
const results = new Map<string, Kept>();
const busy = new WeakSet<WebContents>();
const watched = new WeakSet<BrowserController>();

function forget(c: BrowserController): void {
  for (const [id, kept] of results) if (kept.owner === c) results.delete(id);
}

/** Previews fit this box (the popover shows them small). */
const PREVIEW = { width: 320, height: 240 };

/** The active tab's page, when it shows a web page (internal pages are drawn by the UI). */
function activePage(c: BrowserController): { contents: WebContents; url: string } | null {
  const tabId = c.tabs.activeTabId;
  const tab = c.tabs.getState().tabs.find((item) => item.id === tabId);
  const contents = tabId ? c.tabs.pageOf(tabId) : null;
  if (!tab || !contents || contents.isDestroyed() || !/^(https?|file):/.test(tab.url) || tab.interstitial) return null;
  return { contents, url: tab.url };
}

type Send = (method: string, params?: object) => Promise<unknown>;

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

async function screenshot(send: Send, clip: CaptureRect): Promise<NativeImage> {
  const { data } = (await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...clip, scale: 1 } })) as { data: string };
  return nativeImage.createFromBuffer(Buffer.from(data, "base64"));
}

const capturers: Record<CaptureMode, (contents: WebContents) => Promise<NativeImage | null>> = {
  visible: (contents) => contents.capturePage(),
  full: (contents) =>
    withDebugger(contents, async (send) => {
      const metrics = (await send("Page.getLayoutMetrics")) as { cssContentSize: { width: number; height: number } };
      return screenshot(send, fullPageClip(metrics.cssContentSize));
    }),
  element: async (contents) => {
    contents.focus();
    const picked: unknown = await contents.executeJavaScriptInIsolatedWorld(PICK_WORLD_ID, [{ code: PICK_SCRIPT }], true).catch(() => null);
    if (typeof picked !== "object" || picked === null) return null;
    const { rect, page } = picked as { rect?: unknown; page?: unknown };
    if (!isCaptureRect(rect) || !isCaptureRect({ x: 0, y: 0, ...(page as object) })) return null;
    const clip = elementClip(rect, page as { width: number; height: number });
    return clip && !contents.isDestroyed() ? withDebugger(contents, (send) => screenshot(send, clip)) : null;
  },
};

/** Takes a screenshot of the active tab, then shows the result popover. */
export async function capture(c: BrowserController, mode: CaptureMode): Promise<void> {
  const page = activePage(c);
  if (!page || busy.has(page.contents)) return;
  busy.add(page.contents);
  // The page gets the input back (element picker), and the overlay is not in the way.
  c.overlay.close();
  let image: NativeImage | null = null;
  try {
    image = await capturers[mode](page.contents);
  } catch (error) {
    console.warn("Capture:", error);
  } finally {
    busy.delete(page.contents);
  }
  if (!image || image.isEmpty() || c.window.isDestroyed()) return;
  forget(c);
  if (!watched.has(c)) {
    watched.add(c);
    c.window.once("closed", () => forget(c));
  }
  const id = randomUUID();
  results.set(id, { image, name: captureFileName(page.url, new Date()), owner: c });
  const { width, height } = image.getSize();
  const scale = Math.min(1, PREVIEW.width / width, PREVIEW.height / height);
  const small = image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: "good" });
  c.overlay.open({ kind: "capture-result", capture: { id, width, height, preview: `data:image/jpeg;base64,${small.toJPEG(82).toString("base64")}` } });
}

const resultOf = (c: BrowserController, id: string) => {
  const kept = results.get(id);
  return kept?.owner === c ? kept : undefined;
};

export async function copyCapture(c: BrowserController, id: string): Promise<boolean> {
  const kept = resultOf(c, id);
  if (!kept) return false;
  try {
    await clipboard.write([new ClipboardItem({ "image/png": new Blob([kept.image.toPNG()], { type: "image/png" }) })]);
    return true;
  } catch {
    return false;
  }
}

export async function saveCapture(c: BrowserController, id: string): Promise<boolean> {
  const kept = resultOf(c, id);
  if (!kept) return false;
  const { canceled, filePath } = await dialog.showSaveDialog(c.window, {
    title: "Enregistrer la capture",
    defaultPath: join(downloadsFolder(), kept.name),
    filters: [{ name: "Image PNG", extensions: ["png"] }],
  });
  if (canceled || !filePath) return false;
  try {
    await writeFile(filePath, kept.image.toPNG());
    return true;
  } catch {
    return false;
  }
}

export function discardCapture(c: BrowserController, id: string): void {
  if (resultOf(c, id)) results.delete(id);
}

/** Page options popover (ADR-031): below the address bar, else at the top-left corner of the page. */
export function showPageOptions(c: BrowserController, anchor?: Bounds): void {
  const tabId = c.tabs.activeTabId;
  const tab = c.tabs.getState().tabs.find((item) => item.id === tabId);
  if (!tab?.url) return;
  const { x, y } = c.tabs.viewBounds;
  c.overlay.open({ kind: "page-options", tabId: tab.id, anchor: anchor ?? { x: x + 8, y, width: 0, height: 0 } });
}
