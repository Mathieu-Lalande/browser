import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushJsonWriters } from "./json-file";
import { PermissionStore } from "./permission-store";
import { PermissionPrompts, permissionKinds } from "./permissions";
import { ShieldsAllowList } from "./shields";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "browser-privacy-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

describe("ShieldsAllowList", () => {
  it("persists hosts atomically and reloads them", async () => {
    const file = join(dir, "shields.json");
    const list = new ShieldsAllowList(file);
    const changed = vi.fn();
    list.onChange(changed);
    expect(list.isEnabled("example.com")).toBe(true);

    await list.setEnabled("Example.com", false);
    expect(list.isEnabled("example.com")).toBe(false);
    expect(changed).toHaveBeenCalledOnce();
    expect(readJson(file)).toEqual({ disabledHosts: ["example.com"] });
    expect(readdirSync(dir)).toEqual(["shields.json"]); // no temp file left behind

    expect(new ShieldsAllowList(file).isEnabled("example.com")).toBe(false);
    await list.setEnabled("example.com", true);
    expect(new ShieldsAllowList(file).isEnabled("example.com")).toBe(true);
  });

  it("writes pending saves synchronously on quit (flushJsonWriters)", async () => {
    const file = join(dir, "shields.json");
    const list = new ShieldsAllowList(file);
    const saved = list.setEnabled("a.com", false);
    void list.setEnabled("b.com", false);
    // Quitting before the asynchronous writes ran: the latest data is on disk right away.
    flushJsonWriters();
    expect(readJson(file)).toEqual({ disabledHosts: ["a.com", "b.com"] });
    await saved;
    await list.setEnabled("c.com", false);
    expect(readJson(file)).toEqual({ disabledHosts: ["a.com", "b.com", "c.com"] });
    expect(readdirSync(dir)).toEqual(["shields.json"]);
  });

  it("ignores corrupt or malformed files", () => {
    const file = join(dir, "shields.json");
    writeFileSync(file, "{not json");
    expect(new ShieldsAllowList(file).isEnabled("a.com")).toBe(true);
    writeFileSync(file, JSON.stringify({ disabledHosts: [42, "", "b.com"] }));
    const list = new ShieldsAllowList(file);
    expect(list.isEnabled("b.com")).toBe(false);
    expect(list.isEnabled("42")).toBe(true);
  });
});

describe("PermissionStore", () => {
  it("keeps session decisions in memory and persists remembered ones", async () => {
    const file = join(dir, "permissions.json");
    const store = new PermissionStore(file);
    await store.set("https://a.com", "camera", "allow", false);
    expect(store.get("https://a.com", "camera")).toBe("allow");
    expect(new PermissionStore(file).get("https://a.com", "camera")).toBeUndefined();

    await store.set("https://a.com", "notifications", "deny", true);
    expect(readJson(file)).toEqual({ "https://a.com": { notifications: "deny" } });
    const reloaded = new PermissionStore(file);
    expect(reloaded.get("https://a.com", "notifications")).toBe("deny");
    expect(reloaded.get("https://b.com", "notifications")).toBeUndefined();
  });

  it("drops invalid entries from disk", () => {
    const file = join(dir, "permissions.json");
    writeFileSync(file, JSON.stringify({ "https://a.com": { camera: "maybe", microphone: "allow" }, "https://b.com": 3 }));
    const store = new PermissionStore(file);
    expect(store.get("https://a.com", "camera")).toBeUndefined();
    expect(store.get("https://a.com", "microphone")).toBe("allow");
  });
});

describe("permissionKinds", () => {
  it("maps Electron permissions to prompt kinds", () => {
    expect(permissionKinds("media", ["video", "audio"])).toEqual(["camera", "microphone"]);
    expect(permissionKinds("media", ["audio"])).toEqual(["microphone"]);
    expect(permissionKinds("media", [])).toBeNull();
    expect(permissionKinds("midiSysex")).toEqual(["midi-sysex"]);
    expect(permissionKinds("top-level-storage-access")).toEqual(["storage-access"]);
    expect(permissionKinds("openExternal")).toBeNull();
    expect(permissionKinds("usb")).toBeNull();
  });
});

describe("PermissionPrompts", () => {
  const setup = () => {
    const store = new PermissionStore(null);
    const changes: number[] = [];
    return { store, changes, prompts: new PermissionPrompts(store, (id) => changes.push(id)) };
  };

  it("queues per tab, answers duplicates together and remembers the decision", () => {
    const { prompts, changes } = setup();
    const first = vi.fn();
    const duplicate = vi.fn();
    const other = vi.fn();
    prompts.request(1, "https://a.com/page", ["notifications"], first);
    prompts.request(1, "https://a.com/other", ["notifications"], duplicate);
    prompts.request(1, "https://a.com/", ["geolocation"], other);
    expect(changes).toEqual([1]);

    const head = prompts.current(1)!;
    expect(head).toMatchObject({ origin: "https://a.com", kinds: ["notifications"] });
    prompts.respond(1, head.id, false, false);
    expect(first).toHaveBeenCalledWith(false);
    expect(duplicate).toHaveBeenCalledWith(false);
    expect(other).not.toHaveBeenCalled();
    expect(prompts.current(1)?.kinds).toEqual(["geolocation"]);

    // Decided for the session: no new prompt.
    const again = vi.fn();
    prompts.request(1, "https://a.com/", ["notifications"], again);
    expect(again).toHaveBeenCalledWith(false);
    expect(prompts.check("https://a.com", ["notifications"])).toBe(false);
  });

  it("allows only after every kind is allowed", () => {
    const { prompts, store } = setup();
    void store.set("https://a.com", "camera", "allow", false);
    const callback = vi.fn();
    prompts.request(7, "https://a.com/", ["camera", "microphone"], callback);
    expect(callback).not.toHaveBeenCalled();
    prompts.respond(7, prompts.current(7)!.id, true, false);
    expect(callback).toHaveBeenCalledWith(true);
    expect(prompts.check("https://a.com", ["camera", "microphone"])).toBe(true);
    expect(prompts.current(7)).toBeNull();
  });

  it("denies insecure origins without asking, but lets localhost ask", () => {
    const { prompts } = setup();
    const insecure = vi.fn();
    prompts.request(1, "http://example.com/", ["camera"], insecure);
    expect(insecure).toHaveBeenCalledWith(false);
    expect(prompts.current(1)).toBeNull();

    prompts.request(1, "http://127.0.0.1:8080/", ["camera"], vi.fn());
    expect(prompts.current(1)?.origin).toBe("http://127.0.0.1:8080");
  });

  it("denies everything pending when the tab navigates or closes", () => {
    const { prompts } = setup();
    const a = vi.fn();
    const b = vi.fn();
    prompts.request(3, "https://a.com/", ["camera"], a);
    prompts.request(3, "https://a.com/", ["geolocation"], b);
    prompts.denyAll(3);
    expect(a).toHaveBeenCalledWith(false);
    expect(b).toHaveBeenCalledWith(false);
    expect(prompts.current(3)).toBeNull();
    // Stale answers are ignored.
    prompts.respond(3, "unknown", true, true);
  });
});
