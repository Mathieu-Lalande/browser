import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SyncPlatform, SyncStatus } from "@shared/sync/controller";
import type { CollectionAdapter } from "@shared/sync/engine";
import type { WindowDirectory, WindowPort } from "../ports";

vi.mock("electron", () => ({
  app: { isPackaged: true },
  net: { fetch: vi.fn() },
  Notification: { isSupported: () => false },
  safeStorage: { isEncryptionAvailable: () => false },
}));
const { SyncService } = await import("./service");

/** A controller that records what the service asks of it. */
function fakeController() {
  return {
    init: vi.fn(async () => {}),
    notifyChange: vi.fn(),
    dismissReceivedTab: vi.fn(),
    dispose: vi.fn(),
    getStatus: vi.fn(),
    createAccount: vi.fn(),
    pair: vi.fn(),
    pairingCode: vi.fn(),
    syncNow: vi.fn(),
    sendTab: vi.fn(),
    disconnect: vi.fn(),
    reset: vi.fn(),
  };
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(windows: WindowPort[] = [], adapters: () => CollectionAdapter[] = () => []) {
  const dir = mkdtempSync(join(tmpdir(), "sync-service-"));
  dirs.push(dir);
  const controller = fakeController();
  let platform: SyncPlatform | null = null;
  const local = new Set<() => void>();
  const directory = { all: () => windows, focused: () => undefined } as unknown as WindowDirectory;
  const service = new SyncService({
    userData: dir,
    windows: directory,
    onLocalChange: (listener) => {
      local.add(listener);
      return () => local.delete(listener);
    },
    adapters,
    createController: (given) => {
      platform = given;
      return controller as never;
    },
  });
  const change = () => local.forEach((listener) => listener());
  return { service, controller, change, local, platform: () => platform as SyncPlatform, built: () => platform !== null };
}

describe("SyncService", () => {
  it("builds the controller lazily, once", () => {
    const { service, platform, built } = setup();
    expect(built()).toBe(false);
    expect(service.controller).toBe(service.controller);
    expect(platform().kind).toBe("desktop");
  });

  it("starts once: init, then local changes schedule a sync until it stops", () => {
    const { service, controller, change, local } = setup();
    service.start();
    service.start();
    expect(controller.init).toHaveBeenCalledTimes(1);
    expect(local.size).toBe(1);
    change();
    expect(controller.notifyChange).toHaveBeenCalledTimes(1);

    service.stop();
    expect(controller.dispose).toHaveBeenCalled();
    expect(local.size).toBe(0);
    change();
    expect(controller.notifyChange).toHaveBeenCalledTimes(1);
  });

  it("forwards statuses, and opens received tabs in a normal window only", async () => {
    const created: string[] = [];
    const normal = { isPrivate: false, tabs: { create: (url: string) => created.push(url) } } as unknown as WindowPort;
    const privateWindow = { isPrivate: true, tabs: { create: () => created.push("private") } } as unknown as WindowPort;
    const { service, controller, platform } = setup([privateWindow, normal]);
    const seen: SyncStatus[] = [];
    service.onStatus((status) => seen.push(status));
    service.start();
    const status = { received: [{ id: "r1", url: "https://example.com/", title: "Ex", fromName: "Phone" }] } as unknown as SyncStatus;
    platform().onStatus(status);
    platform().onStatus(status);
    await Promise.resolve();
    expect(seen).toHaveLength(2);
    expect(created).toEqual(["https://example.com/"]);
    expect(controller.dismissReceivedTab).toHaveBeenCalledWith("r1");
  });

  it("does not notify changes made while remote changes are applied", async () => {
    let applied = false;
    const adapter: CollectionAdapter = { name: "boosts", snapshot: () => new Map(), sanitize: () => null, apply: () => ((applied = true), change()) };
    const { service, controller, change, platform } = setup([], () => [adapter]);
    service.start();
    await platform().adapters()[0].apply({ upserts: [], deletes: [] });
    expect(applied).toBe(true);
    expect(controller.notifyChange).not.toHaveBeenCalled();
  });
});
