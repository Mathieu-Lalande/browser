import { describe, expect, it } from "vitest";
import { LaunchRouter, launchUrl, launchUrls, type LaunchContext, type LaunchWindow, type LaunchWindows } from "./launch";
import { DefaultBrowserService, WINDOWS_DEFAULT_APPS_URL, type DefaultClientPort } from "./service";

const files = new Set(["/home/a/page.html", "/home/a/doc.PDF", "/home/a/notes.txt", "C:\\docs\\a.htm"]);
const context: LaunchContext = { cwd: "/home/a", isFile: (path) => files.has(path) };

describe("launch URLs", () => {
  it("keeps web pages only, as links opened by pages", () => {
    expect(launchUrl("https://example.com/a?b#c", context)).toBe("https://example.com/a?b#c");
    expect(launchUrl("http://example.com", context)).toBe("http://example.com/");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "browser://settings", "app://browser/index.html", "mailto:a@b.c", "chrome://settings", "ftp://x", ""]) {
      expect(launchUrl(bad, context)).toBeNull();
    }
  });

  it("opens existing local files of the associated types", () => {
    expect(launchUrl("page.html", context)).toBe("file:///home/a/page.html");
    expect(launchUrl("/home/a/doc.PDF", context)).toBe("file:///home/a/doc.PDF");
    expect(launchUrl("file:///home/a/page.html", context)).toBe("file:///home/a/page.html");
    expect(launchUrl("/home/a/notes.txt", context)).toBeNull();
    expect(launchUrl("/home/a/missing.html", context)).toBeNull();
    expect(launchUrl(".", context)).toBeNull();
  });

  it("reads a command line: no executable, no switches, no duplicates", () => {
    const argv = ["/opt/browser", "--no-sandbox", ".", "https://a.example/", "page.html", "https://a.example/", "--flag=https://b.example/"];
    expect(launchUrls(argv, context)).toEqual(["https://a.example/", "file:///home/a/page.html"]);
    expect(launchUrls(["/opt/browser", ...Array.from({ length: 30 }, (_, i) => `https://x${i}.example/`)], context)).toHaveLength(20);
  });
});

class FakeWindow implements LaunchWindow {
  opened: string[] = [];
  focused = 0;
  newTabs = 0;
  spaces: string[] = [];
  constructor(readonly isPrivate = false) {}
  openUrl(url: string): void {
    this.opened.push(url);
  }
  focus(): void {
    this.focused++;
  }
  newTab(): void {
    this.newTabs++;
  }
  showSpace(id: string): void {
    this.spaces.push(id);
  }
}

/** Windows of a fake app: the last normal one, private ones, mini windows (ADR-048). */
function fakeWindows(miniEnabled = false) {
  const created: FakeWindow[] = [];
  const minis: string[] = [];
  let last: FakeWindow | undefined;
  const windows: LaunchWindows = {
    lastNormal: () => last,
    create: () => {
      last = new FakeWindow();
      created.push(last);
      return last;
    },
    createPrivate: () => {
      const window = new FakeWindow(true);
      created.push(window);
      return window;
    },
    mini: { enabled: () => miniEnabled, open: (url) => void minis.push(url) },
  };
  return { windows, created, minis, last: () => last };
}

describe("LaunchRouter", () => {
  it("waits for the windows, then opens in the last normal window", () => {
    const normal = new FakeWindow();
    let last: FakeWindow | undefined;
    const router = new LaunchRouter(() => ({
      lastNormal: () => last,
      create: () => (last = new FakeWindow()),
      createPrivate: () => new FakeWindow(true),
    }));
    router.open(["https://a.example/"]);
    expect(last).toBeUndefined();
    router.ready();
    expect(last?.opened).toEqual(["https://a.example/"]);
    last = normal;
    router.open(["https://b.example/", "https://c.example/"]);
    expect(normal.opened).toEqual(["https://b.example/", "https://c.example/"]);
    expect(normal.focused).toBe(1);
  });

  it("sends one web link to a mini window once running, when enabled (ADR-048)", () => {
    const app = fakeWindows(true);
    const router = new LaunchRouter(() => app.windows);
    router.open(["https://cold.example/"]);
    router.ready();
    expect(app.last()?.opened).toEqual(["https://cold.example/"]);
    expect(app.minis).toEqual([]);
    router.open(["https://warm.example/"]);
    expect(app.minis).toEqual(["https://warm.example/"]);
    router.open(["https://a.example/", "https://b.example/"]);
    expect(app.last()?.opened).toEqual(["https://cold.example/", "https://a.example/", "https://b.example/"]);
    router.open(["file:///home/a/page.html"]);
    expect(app.minis).toHaveLength(1);
    const off = fakeWindows(false);
    const plain = new LaunchRouter(() => off.windows);
    plain.ready();
    plain.open(["https://warm.example/"]);
    expect(off.minis).toEqual([]);
    expect(off.last()?.opened).toEqual(["https://warm.example/"]);
  });

  it("runs --new-tab, --space and --private, after the windows exist", () => {
    const app = fakeWindows();
    const router = new LaunchRouter(() => app.windows);
    router.act({ newTab: true, private: false, spaceId: "work" });
    expect(app.created).toHaveLength(0);
    router.ready();
    expect(app.last()?.spaces).toEqual(["work"]);
    expect(app.last()?.newTabs).toBe(1);
    router.act({ newTab: false, private: true, spaceId: null });
    expect(app.created.map((window) => window.isPrivate)).toEqual([false, true]);
    expect(app.last()?.newTabs).toBe(1);
    router.act(null);
    expect(app.created).toHaveLength(2);
  });
});

function port(overrides: Partial<DefaultClientPort> = {}): DefaultClientPort & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    platform: "linux",
    packaged: true,
    appName: "Browser",
    isDefaultProtocolClient: () => false,
    setAsDefaultProtocolClient: (protocol) => (calls.push(`set:${protocol}`), true),
    defaultAppNameFor: () => "Edge",
    openExternal: async (url) => void calls.push(`open:${url}`),
    ...overrides,
  };
}

describe("DefaultBrowserService", () => {
  it("never registers an unpackaged run", async () => {
    const fake = port({ packaged: false });
    const service = new DefaultBrowserService(fake);
    expect(service.status().state).toBe("unavailable");
    expect((await service.makeDefault()).state).toBe("unavailable");
    expect(fake.calls).toEqual([]);
  });

  it("registers http and https on Linux and macOS", async () => {
    let registered = false;
    const fake = port({ isDefaultProtocolClient: () => registered, setAsDefaultProtocolClient: () => (registered = true) });
    const service = new DefaultBrowserService(fake);
    expect(service.status()).toEqual({ state: "not-default", message: null });
    expect((await service.makeDefault()).state).toBe("default");
  });

  it("opens Windows Settings, and reads the user's choice there", async () => {
    let chosen = "Edge";
    const fake = port({ platform: "win32", isDefaultProtocolClient: () => true, defaultAppNameFor: () => chosen });
    const service = new DefaultBrowserService(fake);
    expect(service.status().state).toBe("not-default");
    const after = await service.makeDefault();
    expect(fake.calls).toEqual([`open:${WINDOWS_DEFAULT_APPS_URL}`]);
    expect(after.message).toMatch(/Paramètres de Windows/);
    chosen = "Browser";
    expect(service.status().state).toBe("default");
  });
});
