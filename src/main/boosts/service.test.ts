import type { WebContents } from "electron";
import { describe, expect, it } from "vitest";
import { newBoost, type Boost } from "@shared/boosts";
import { Channels } from "@shared/ipc";
import type { TabState } from "@shared/types";
import type { WindowDirectory, WindowPort } from "../ports";
import { BoostService } from "./service";

/** A page that records the CSS inserted and removed, and the scripts run. */
class FakePage {
  inserted = new Map<string, string>();
  scripts: { world: number; code: string }[] = [];
  destroyed = false;
  private next = 0;
  constructor(public url: string) {}
  getURL = () => this.url;
  isDestroyed = () => this.destroyed;
  insertCSS = async (css: string) => {
    const key = `k${++this.next}`;
    this.inserted.set(key, css);
    return key;
  };
  removeInsertedCSS = async (key: string) => void this.inserted.delete(key);
  executeJavaScriptInIsolatedWorld = async (world: number, [{ code }]: { code: string }[]) => {
    this.scripts.push({ world, code });
    return null;
  };
  get css(): string[] {
    return [...this.inserted.values()];
  }
}

function setup(url = "https://example.com/page", isPrivate = false) {
  let boosts: readonly Boost[] = [];
  const page = new FakePage(url);
  const contents = page as unknown as WebContents;
  const sent: string[] = [];
  const tab = { id: "t1", url } as TabState;
  const window = {
    isPrivate,
    tabs: { activeTabId: "t1", getState: () => ({ tabs: [tab] }), pageOf: () => contents },
    spaces: { allTabs: () => [{ manager: { pageOf: () => contents }, tab }] },
    overlay: { close: () => {} },
    send: (channel: string) => sent.push(channel),
  } as unknown as WindowPort;
  const windows = { all: () => [window] } as unknown as WindowDirectory;
  let id = 0;
  const service = new BoostService({
    store: { list: () => boosts, save: (next) => (boosts = next) },
    windows,
    now: () => 1000,
    newId: () => `b${++id}`,
  });
  const settle = () => service.restyle(contents);
  return { service, page, contents, window, sent, settle, boosts: () => boosts };
}

const styled = (host: string, css: string): Boost => ({ ...newBoost("b0", host, 1), css });

describe("BoostService", () => {
  it("applies the site's CSS to a new document, then replaces it live after a change", async () => {
    const { service, page, contents, window, settle, sent } = setup();
    service.setBoosts([styled("example.com", "body { color: red }")]);
    service.boostPage(contents, false);
    await settle();
    expect(page.css.join()).toContain("color: red");

    service.save(window, { ...styled("example.com", "body { color: blue }") });
    await settle();
    expect(page.css).toHaveLength(1);
    expect(page.css[0]).toContain("color: blue");
    expect(sent).toContain(Channels.boostsChanged);
  });

  it("removes the CSS when the boost goes away", async () => {
    const { service, page, contents, window, settle } = setup();
    service.setBoosts([styled("example.com", "p { margin: 0 }")]);
    service.boostPage(contents, false);
    await settle();
    expect(page.css).toHaveLength(1);
    service.remove(window, "b0");
    await settle();
    expect(page.css).toHaveLength(0);
  });

  it("leaves other sites alone", async () => {
    const { service, page, contents, settle } = setup("https://other.org/");
    service.setBoosts([styled("example.com", "p { margin: 0 }")]);
    service.boostPage(contents, false);
    await settle();
    expect(page.css).toHaveLength(0);
  });

  it("refuses changes from a private window, but creates a site boost from a normal one", () => {
    const priv = setup("https://example.com/", true);
    expect(priv.service.save(priv.window, styled("example.com", "a {}")).ok).toBe(false);
    expect(priv.service.createForTab(priv.window, "t1")?.boost).toBeNull();
    expect(priv.boosts()).toHaveLength(0);

    const normal = setup("https://example.com/");
    const created = normal.service.createForTab(normal.window, "t1");
    expect(created).toMatchObject({ host: "example.com", isPrivate: false, zapping: false });
    expect(created?.boost?.id).toBe("b1");
  });
});
