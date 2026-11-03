import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSession, type SessionWindow } from "../storage/session";
import type { WindowPort } from "../ports";
import { CrashMarker } from "./crash-marker";
import { RecoveryService } from "./service";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "recovery-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const savedWindow = (...urls: string[]): SessionWindow => ({
  activeSpaceId: "personal",
  spaces: [{ spaceId: "personal", tabs: urls.map((url) => ({ url, title: url, favicon: null, pinned: false })), activeIndex: 0 }],
});

describe("CrashMarker", () => {
  it("detects a run that did not quit cleanly", () => {
    const dir = tempDir();
    expect(new CrashMarker(dir).begin()).toBe(false);
    // Killed: the marker is still there at the next start.
    expect(new CrashMarker(dir).begin()).toBe(true);
    const clean = new CrashMarker(dir);
    clean.end();
    expect(clean.begin()).toBe(false);
  });
});

describe("session snapshot and restore", () => {
  it("round-trips windows, spaces, folders and split through parseSession", () => {
    const window: SessionWindow = {
      activeSpaceId: "personal",
      spaces: [
        {
          spaceId: "personal",
          tabs: [
            { url: "https://a.example/", title: "A", favicon: null, pinned: true },
            { url: "https://b.example/", title: "B", favicon: null, pinned: false, folderId: "f1" },
            { url: "https://c.example/", title: "C", favicon: null, pinned: false },
          ],
          activeIndex: 2,
          split: { tabIndexes: [1, 2], ratioX: 0.4, ratioY: 0.5 },
          folders: [{ id: "f1", name: "Projet", icon: "folder", parentId: null, collapsed: false }],
        },
      ],
    };
    const session = { spaces: [{ id: "personal", name: "Personnel", icon: "circle-user" as const, color: null, isolated: false }], windows: [window, savedWindow("https://d.example/")] };
    const parsed = parseSession(JSON.parse(JSON.stringify(session)));
    expect(parsed?.windows).toHaveLength(2);
    expect(parsed?.windows[0].spaces[0]).toMatchObject({ activeIndex: 2, split: { tabIndexes: [1, 2] }, tabs: [{ pinned: true }, { folderId: "f1" }, {}] });
  });
});

describe("RecoveryService", () => {
  const windowPort = (urls: string[]) => {
    const close = vi.fn();
    const refresh = vi.fn();
    const port = {
      isPrivate: false,
      window: { close },
      spaces: { refresh, allTabs: () => urls.map((url) => ({ tab: { url } })) },
    } as unknown as WindowPort;
    return { port, close, refresh };
  };

  it("offers a crashed session and restores the chosen windows", () => {
    const opened: SessionWindow[] = [];
    const asking = windowPort([""]);
    const service = new RecoveryService({ windows: { all: () => [asking.port] } as never, openWindow: (saved) => opened.push(saved) });
    service.offer({ spaces: [], windows: [savedWindow("https://a.example/"), savedWindow("https://b.example/", "https://c.example/")] });
    expect(service.summary()).toMatchObject({ tabCount: 3, windows: [{ index: 0 }, { index: 1, tabCount: 2 }] });
    expect(service.restore(asking.port, [1])).toBe(1);
    expect(opened.map((saved) => saved.spaces[0].tabs.length)).toEqual([2]);
    // The empty start-page window gave way; the card is gone everywhere.
    expect(asking.close).toHaveBeenCalled();
    expect(asking.refresh).toHaveBeenCalled();
    expect(service.summary()).toBeNull();
  });

  it("keeps a window showing pages, and ignores", () => {
    const busy = windowPort(["https://x.example/"]);
    const service = new RecoveryService({ windows: { all: () => [busy.port] } as never, openWindow: () => {} });
    service.offer({ spaces: [], windows: [savedWindow("https://a.example/")] });
    service.restore(busy.port, null);
    expect(busy.close).not.toHaveBeenCalled();
    service.offer({ spaces: [], windows: [savedWindow("https://a.example/")] });
    service.dismiss();
    expect(service.summary()).toBeNull();
  });

  it("remembers closed windows, most recent first", () => {
    const opened: SessionWindow[] = [];
    const service = new RecoveryService({ windows: { all: () => [] } as never, openWindow: (saved) => opened.push(saved) });
    service.rememberWindow(savedWindow("https://a.example/"));
    service.rememberWindow(savedWindow("https://b.example/", "https://c.example/"));
    service.rememberWindow(savedWindow());
    expect(service.closedWindows()).toEqual([
      { index: 0, title: "https://b.example/", tabCount: 2 },
      { index: 1, title: "https://a.example/", tabCount: 1 },
    ]);
    expect(service.reopenWindow(1)).toBe(true);
    expect(opened[0].spaces[0].tabs[0].url).toBe("https://a.example/");
    expect(service.reopenWindow(5)).toBe(false);
  });
});
