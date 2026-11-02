import { describe, expect, it } from "vitest";
import { MAX_CAPTURE_PIXELS, MAX_CAPTURE_SIZE, captureFileName, captureScale, captureSite, elementClip, formatDuration, fullPageClip, isCaptureRect } from "./capture";

describe("capture names", () => {
  const date = new Date(2026, 10, 2, 9, 5, 7);

  it("names a screenshot after the site and the local time", () => {
    expect(captureFileName("https://www.exemple.fr/article?x=1", date)).toBe("Capture exemple.fr 2026-11-02 09.05.07.png");
  });

  it("names a recording as a WebM video", () => {
    expect(captureFileName("http://127.0.0.1:8080/video", date, "video")).toBe("Enregistrement 127.0.0.1 2026-11-02 09.05.07.webm");
  });

  it("falls back to a generic name, never a path", () => {
    expect(captureSite("not a url")).toBe("page");
    expect(captureSite("data:text/html,hi")).toBe("page");
    expect(captureFileName("file:///etc/passwd", date)).not.toMatch(/[/:\\]/);
  });
});

describe("capture geometry", () => {
  it("captures the whole document, capped to what Chromium can draw", () => {
    expect(fullPageClip({ width: 1024.4, height: 5000.2 })).toEqual({ x: 0, y: 0, width: 1025, height: 5001 });
    expect(fullPageClip({ width: 800, height: 99999 }).height).toBe(MAX_CAPTURE_SIZE);
    expect(fullPageClip({ width: 0, height: 0 })).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("clips an element to the document, rounding outwards", () => {
    expect(elementClip({ x: 10.5, y: 20.2, width: 100, height: 50 }, { width: 800, height: 600 })).toEqual({ x: 10, y: 20, width: 101, height: 51 });
    expect(elementClip({ x: -20, y: 580, width: 100, height: 50 }, { width: 800, height: 600 })).toEqual({ x: 0, y: 580, width: 80, height: 20 });
    expect(elementClip({ x: 900, y: 0, width: 100, height: 50 }, { width: 800, height: 600 })).toBeNull();
    expect(elementClip({ x: 0, y: 0, width: 0, height: 10 }, { width: 800, height: 600 })).toBeNull();
  });

  it("only accepts finite rectangles from page scripts", () => {
    expect(isCaptureRect({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
    expect(isCaptureRect({ x: 0, y: 0, width: Infinity, height: 1 })).toBe(false);
    expect(isCaptureRect({ x: "0", y: 0, width: 1, height: 1 })).toBe(false);
    expect(isCaptureRect(null)).toBe(false);
  });

  it("keeps ordinary captures at full size", () => {
    expect(captureScale({ width: 1280, height: 16384 })).toBe(1);
    expect(captureScale({ width: 1280, height: 5000 }, 2)).toBe(1);
  });

  it("scales huge captures down to the pixel budget", () => {
    const clip = { width: 16384, height: 16384 };
    const scale = captureScale(clip, 2);
    expect(scale).toBeLessThan(1);
    expect((clip.width * clip.height * (2 * scale) ** 2) / MAX_CAPTURE_PIXELS).toBeCloseTo(1, 6);
    expect(captureScale(clip, Number.NaN)).toBe(captureScale(clip, 1));
  });
});

describe("recording timer", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(5_400)).toBe("0:05");
    expect(formatDuration(754_000)).toBe("12:34");
    expect(formatDuration(3_723_000)).toBe("1:02:03");
    expect(formatDuration(-5)).toBe("0:00");
  });
});
