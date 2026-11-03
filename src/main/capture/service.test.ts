import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { MAX_CAPTURE_PIXELS, captureScale } from "@shared/capture";
import type { OverlayRequest, TabState } from "@shared/types";
import type { WindowDirectory, WindowPort } from "../ports";

vi.mock("electron", () => ({ clipboard: {}, dialog: {}, nativeImage: {}, screen: {}, webContents: {}, ClipboardItem: class {} }));
vi.mock("../ui-session", () => ({ setDisplayCaptureGate: vi.fn(), uiSession: vi.fn() }));
const { CaptureService, previewSize } = await import("./service");

function service(displayScale = 2) {
  return new CaptureService({ windows: {} as WindowDirectory, downloadsFolder: () => "/tmp", displayScale: () => displayScale });
}

/** An image of the given size, whose preview records the size it was resized to. */
function fakeImage(width: number, height: number) {
  const resized: { width: number; height: number }[] = [];
  return {
    resized,
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize: (size: { width: number; height: number }) => {
      resized.push({ width: size.width, height: size.height });
      return { toJPEG: () => Buffer.from("jpeg") };
    },
  };
}

describe("CaptureService size policy", () => {
  it("scales a clip by the densest display times the page zoom", () => {
    const clip = { x: 0, y: 0, width: 800, height: 600 };
    expect(service(2).scaleFor(clip, 1.5)).toBe(captureScale(clip, 3));
    // A display below 1 never shrinks the capture.
    expect(service(0.5).scaleFor(clip, 1)).toBe(captureScale(clip, 1));
  });

  it("keeps a huge page within the pixel budget", () => {
    const clip = { x: 0, y: 0, width: 1200, height: 60_000 };
    const scale = service(2).scaleFor(clip, 1);
    expect(clip.width * clip.height * scale * scale).toBeLessThanOrEqual(MAX_CAPTURE_PIXELS);
  });

  it("fits previews in their box, never scaling up", () => {
    expect(previewSize({ width: 3200, height: 1200 })).toEqual({ width: 320, height: 120 });
    expect(previewSize({ width: 100, height: 50 })).toEqual({ width: 100, height: 50 });
  });

  it("captures the active web page and opens the result popover with its preview", async () => {
    const image = fakeImage(1600, 1200);
    const page = { isDestroyed: () => false, capturePage: async () => image } as unknown as WebContents;
    const opened: OverlayRequest[] = [];
    const window = {
      window: { isDestroyed: () => false, once: () => {} },
      tabs: { activeTabId: "t1", getState: () => ({ tabs: [{ id: "t1", url: "https://example.com/" } as TabState] }), pageOf: () => page },
      overlay: { close: () => {}, open: (request: OverlayRequest) => opened.push(request) },
    } as unknown as WindowPort;
    await service().capture(window, "visible");
    expect(image.resized).toEqual([{ width: 320, height: 240 }]);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ kind: "capture-result", capture: { width: 1600, height: 1200 } });
  });

  it("ignores internal pages", async () => {
    const opened: OverlayRequest[] = [];
    const window = {
      tabs: { activeTabId: "t1", getState: () => ({ tabs: [{ id: "t1", url: "browser://settings" } as TabState] }), pageOf: () => ({ isDestroyed: () => false }) },
      overlay: { close: () => {}, open: (request: OverlayRequest) => opened.push(request) },
    } as unknown as WindowPort;
    await service().capture(window, "visible");
    expect(opened).toHaveLength(0);
  });
});
