import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RateLimiter } from "../src/rate-limit.js";
import { createSyncServer, type ServerOptions } from "../src/server.js";

let dataDir: string;
let base: string;
let close: () => Promise<void>;

async function start(options: Partial<ServerOptions> = {}): Promise<void> {
  const { server } = createSyncServer({ dataDir, ...options });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((resolve) => server.close(() => resolve()));
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sync-server-"));
});
afterEach(async () => {
  await close?.();
  rmSync(dataDir, { recursive: true, force: true });
});

const rid = (n: number) => n.toString(16).padStart(32, "0");
const payload = (text: string) => Buffer.from(text).toString("base64url");

async function signup(headers: Record<string, string> = {}) {
  const response = await fetch(`${base}/v1/accounts`, { method: "POST", headers, body: "{}" });
  return { status: response.status, body: (await response.json().catch(() => null)) as { accountId: string; token: string } };
}

function client(account: { accountId: string; token: string }) {
  const auth = { authorization: `Bearer ${account.accountId}.${account.token}` };
  return {
    get: async (name: string, since = 0, limit?: number) => {
      const response = await fetch(`${base}/v1/collections/${name}?since=${since}${limit ? `&limit=${limit}` : ""}`, { headers: auth });
      return { status: response.status, body: await response.json() };
    },
    post: async (name: string, records: unknown[]) => {
      const response = await fetch(`${base}/v1/collections/${name}`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ records }),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    remove: async () => (await fetch(`${base}/v1/account`, { method: "DELETE", headers: auth })).status,
  };
}

describe("sync relay", () => {
  it("creates accounts and stores only a hash of the token", async () => {
    await start();
    const { status, body } = await signup();
    expect(status).toBe(201);
    expect(body.accountId).toMatch(/^[0-9a-f]{32}$/);
    expect(body.token.length).toBeGreaterThanOrEqual(43);
    const file = readFileSync(join(dataDir, "accounts", `${body.accountId}.json`), "utf8");
    expect(file).not.toContain(body.token);
  });

  it("pulls incrementally and pushes with optimistic concurrency", async () => {
    await start();
    const api = client((await signup()).body);
    expect((await api.get("bookmarks")).body).toEqual({ records: [], version: 0, more: false });

    const first = await api.post("bookmarks", [
      { id: rid(1), base: 0, payload: payload("one") },
      { id: rid(2), base: 0, payload: payload("two") },
    ]);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ previous: 0, version: 2, records: [{ id: rid(1), version: 1 }, { id: rid(2), version: 2 }] });

    // Stale base: nothing is written, the current versions come back.
    const stale = await api.post("bookmarks", [
      { id: rid(1), base: 0, payload: payload("again") },
      { id: rid(3), base: 0, payload: payload("three") },
    ]);
    expect(stale.status).toBe(409);
    expect(stale.body).toEqual({ conflicts: [{ id: rid(1), version: 1 }] });

    const update = await api.post("bookmarks", [{ id: rid(1), base: 1, payload: null }]);
    expect(update.body).toMatchObject({ previous: 2, version: 3 });
    const since = await api.get("bookmarks", 2);
    expect(since.body).toMatchObject({ version: 3, more: false, records: [{ id: rid(1), version: 3, payload: null }] });
    expect((await api.get("history")).body.records).toEqual([]);
  });

  it("pages large collections", async () => {
    await start();
    const api = client((await signup()).body);
    await api.post("history", Array.from({ length: 5 }, (_, i) => ({ id: rid(i + 1), base: 0, payload: payload(`p${i}`) })));
    const page = await api.get("history", 0, 2);
    expect(page.body).toMatchObject({ more: true, version: 2 });
    expect(page.body.records).toHaveLength(2);
    const rest = await api.get("history", 2, 10);
    expect(rest.body).toMatchObject({ more: false, version: 5 });
  });

  it("refuses bad tokens, bad input and web pages", async () => {
    await start();
    const account = (await signup()).body;
    const api = client(account);
    expect((await client({ ...account, token: "x".repeat(43) }).get("bookmarks")).status).toBe(401);
    expect((await fetch(`${base}/v1/collections/bookmarks`)).status).toBe(401);
    expect((await api.get("Bad-Name")).status).toBe(404);
    expect((await api.post("bookmarks", [{ id: "nothex", base: 0, payload: "x" }])).status).toBe(400);
    expect((await api.post("bookmarks", [{ id: rid(1), base: 0, payload: "not base64!" }])).status).toBe(400);
    expect((await api.post("bookmarks", Array.from({ length: 201 }, (_, i) => ({ id: rid(i + 1), base: 0, payload: "x" })))).status).toBe(400);
    const fromPage = await fetch(`${base}/v1/collections/bookmarks`, {
      headers: { authorization: `Bearer ${account.accountId}.${account.token}`, origin: "https://evil.example" },
    });
    expect(fromPage.status).toBe(403);
    expect(fromPage.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("limits request bodies and account size", async () => {
    await start({ maxBodyBytes: 4096, maxAccountBytes: 100 });
    const api = client((await signup()).body);
    expect((await api.post("bookmarks", [{ id: rid(1), base: 0, payload: "a".repeat(5000) }])).status).toBe(413);
    expect((await api.post("bookmarks", [{ id: rid(1), base: 0, payload: "a".repeat(101) }])).status).toBe(507);
    expect((await api.post("bookmarks", [{ id: rid(1), base: 0, payload: "a".repeat(100) }])).status).toBe(200);
  });

  it("requires the registration secret when one is set", async () => {
    await start({ registrationSecret: "s3cret" });
    expect((await signup()).status).toBe(403);
    expect((await signup({ "x-registration-secret": "wrong" })).status).toBe(403);
    expect((await signup({ "x-registration-secret": "s3cret" })).status).toBe(201);
  });

  it("rate limits per client address", async () => {
    await start({ requestsPerMinute: 3, accountsPerHour: 1 });
    expect((await signup()).status).toBe(201);
    const second = await fetch(`${base}/v1/accounts`, { method: "POST", body: "{}" });
    expect(second.status).toBe(429);
    expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("deletes an account and everything in it", async () => {
    await start();
    const account = (await signup()).body;
    const api = client(account);
    await api.post("bookmarks", [{ id: rid(1), base: 0, payload: payload("x") }]);
    expect(await api.remove()).toBe(204);
    expect((await api.get("bookmarks")).status).toBe(401);
    expect(readdirSync(join(dataDir, "accounts"))).toEqual([]);
  });

  it("keeps data across restarts", async () => {
    await start();
    const account = (await signup()).body;
    await client(account).post("spaces", [{ id: rid(9), base: 0, payload: payload("kept") }]);
    await close();
    await start();
    expect((await client(account).get("spaces")).body.records).toHaveLength(1);
  });
});

describe("devices and key rotation (ADR-056)", () => {
  const wrap = (n: number) => Buffer.alloc(73, n).toString("base64url");

  function devices(account: { accountId: string; token: string }, epoch = 0) {
    const auth = { authorization: `Bearer ${account.accountId}.${account.token}` };
    return {
      list: async () => (await (await fetch(`${base}/v1/devices`, { headers: auth })).json()) as { epoch: number; self: string | null; legacy: boolean; devices: { authId: string; pending: boolean }[] },
      add: async () => {
        const response = await fetch(`${base}/v1/devices`, { method: "POST", headers: auth, body: "{}" });
        return { status: response.status, body: (await response.json()) as { authId: string; token: string } };
      },
      leave: async () => (await fetch(`${base}/v1/devices/self`, { method: "DELETE", headers: auth })).status,
      keyring: async (since = 0) => {
        const response = await fetch(`${base}/v1/keyring?since=${since}`, { headers: auth });
        return { status: response.status, body: (await response.json().catch(() => null)) as { epoch: number; wraps: { epoch: number; wrap: string }[] } };
      },
      rotate: async (body: unknown) => {
        const response = await fetch(`${base}/v1/keyring`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body) });
        return { status: response.status, body: (await response.json().catch(() => null)) as { epoch: number } };
      },
      get: async (name: string) => (await fetch(`${base}/v1/collections/${name}`, { headers: { ...auth, "x-sync-epoch": String(epoch) } })).status,
    };
  }

  it("gives every device its own token, hashed on disk", async () => {
    await start();
    const first = (await signup()).body as { accountId: string; token: string; authId: string };
    expect(first.authId).toMatch(/^[0-9a-f]{32}$/);
    const paired = await devices(first).add();
    expect(paired.status).toBe(201);
    const second = { accountId: first.accountId, token: paired.body.token };
    expect((await devices(first).list()).devices.find((d) => d.authId === paired.body.authId)?.pending).toBe(true);
    expect(await devices(second).get("bookmarks")).toBe(200);
    const list = await devices(second).list();
    expect(list).toMatchObject({ epoch: 0, self: paired.body.authId, legacy: false });
    expect(list.devices.every((d) => !d.pending)).toBe(true);
    const file = readFileSync(join(dataDir, "accounts", `${first.accountId}.json`), "utf8");
    expect(file).not.toContain(first.token);
    expect(file).not.toContain(paired.body.token);
    // Leaving removes only this device's token.
    expect(await devices(second).leave()).toBe(204);
    expect(await devices(second).get("bookmarks")).toBe(401);
    expect(await devices(first).get("bookmarks")).toBe(200);
  });

  it("expires pairing tokens nobody used", async () => {
    let time = 1_000_000;
    await start({ now: () => time });
    const first = (await signup()).body;
    const paired = (await devices(first).add()).body;
    time += 2 * 60 * 60 * 1000;
    expect(await devices({ accountId: first.accountId, token: paired.token }).get("bookmarks")).toBe(401);
    expect((await devices(first).list()).devices).toHaveLength(1);
  });

  it("rotates: revokes a device, hands each remaining one only its wrap, wipes the old data", async () => {
    await start();
    const a = (await signup()).body as { accountId: string; token: string; authId: string };
    const bAuth = (await devices(a).add()).body;
    const cAuth = (await devices(a).add()).body;
    const b = { accountId: a.accountId, token: bAuth.token };
    const c = { accountId: a.accountId, token: cAuth.token };
    await client(a).post("bookmarks", [{ id: rid(1), base: 0, payload: payload("old-key") }]);

    // Every remaining device must get a wrap, and the revoked one must not.
    expect((await devices(a).rotate({ epoch: 1, revoke: [cAuth.authId], wraps: { [a.authId]: wrap(1) } })).status).toBe(409);
    expect((await devices(a).rotate({ epoch: 1, revoke: [cAuth.authId], wraps: { [a.authId]: wrap(1), [bAuth.authId]: wrap(2), [cAuth.authId]: wrap(3) } })).status).toBe(409);
    expect((await devices(a).rotate({ epoch: 2, revoke: [cAuth.authId], wraps: { [a.authId]: wrap(1), [bAuth.authId]: wrap(2) } })).status).toBe(409);
    expect((await devices(a).rotate({ epoch: 1, revoke: [a.authId], wraps: { [bAuth.authId]: wrap(2), [cAuth.authId]: wrap(3) } })).status).toBe(400);
    const done = await devices(a).rotate({ epoch: 1, revoke: [cAuth.authId], wraps: { [a.authId]: wrap(1), [bAuth.authId]: wrap(2) } });
    expect(done).toEqual({ status: 200, body: { epoch: 1 } });

    // The revoked device is out: no data, no wrap.
    expect(await devices(c, 1).get("bookmarks")).toBe(401);
    expect((await devices(c).keyring()).status).toBe(401);
    // The others get their own wrap only, and must move to the new epoch.
    expect((await devices(b).keyring()).body).toEqual({ epoch: 1, wraps: [{ epoch: 1, wrap: wrap(2) }] });
    expect((await devices(b).keyring(1)).body.wraps).toEqual([]);
    expect(await devices(b, 0).get("bookmarks")).toBe(412);
    const fresh = await fetch(`${base}/v1/collections/bookmarks`, { headers: { authorization: `Bearer ${b.accountId}.${b.token}`, "x-sync-epoch": "1" } });
    expect((await fresh.json()).records).toEqual([]);
    expect(readFileSync(join(dataDir, "accounts", `${a.accountId}.json`), "utf8")).not.toContain(payload("old-key"));
  });

  it("revokes the legacy shared token at the first rotation", async () => {
    await start();
    const a = (await signup()).body as { accountId: string; token: string; authId: string };
    // An account from before ADR-056: one token shared by every device.
    const path = join(dataDir, "accounts", `${a.accountId}.json`);
    const legacyToken = "l".repeat(43);
    const stored = JSON.parse(readFileSync(path, "utf8"));
    stored.tokenHash = createHash("sha256").update(legacyToken).digest("hex");
    writeFileSync(path, JSON.stringify(stored));
    await close();
    await start();
    const legacy = { accountId: a.accountId, token: legacyToken };
    expect(await devices(legacy).get("bookmarks")).toBe(200);
    expect((await devices(legacy).list()).legacy).toBe(true);
    // A legacy device moves to its own token; it cannot rotate with the shared one.
    expect((await devices(legacy).rotate({ epoch: 1, revoke: [], wraps: { [a.authId]: wrap(1) } })).status).toBe(403);
    const own = (await devices(legacy).add()).body;
    expect((await devices(a).rotate({ epoch: 1, revoke: [], wraps: { [a.authId]: wrap(1), [own.authId]: wrap(2) } })).status).toBe(200);
    expect(await devices(legacy, 1).get("bookmarks")).toBe(401);
    expect(await devices({ accountId: a.accountId, token: own.token }, 1).get("bookmarks")).toBe(200);
  });
});

describe("rate limiter", () => {
  it("refills over time", () => {
    let now = 0;
    const limiter = new RateLimiter(2, 1000, () => now);
    expect(limiter.take("a")).toBe(0);
    expect(limiter.take("a")).toBe(0);
    expect(limiter.take("a")).toBeGreaterThan(0);
    expect(limiter.take("b")).toBe(0);
    now = 500;
    expect(limiter.take("a")).toBe(0);
  });
});

describe("crash receiver (ADR-043)", () => {
  const crash = (body: string | Buffer = "--b\r\nminidump\r\n--b--", headers: Record<string, string> = {}) =>
    fetch(`${base}/crash`, { method: "POST", headers: { "content-type": "multipart/form-data; boundary=b", ...headers }, body });

  it("is off unless enabled", async () => {
    await start();
    expect((await crash()).status).toBe(404);
  });

  it("stores multipart minidumps and answers their id", async () => {
    await start({ crashReports: true });
    const response = await crash();
    expect(response.status).toBe(200);
    const id = await response.text();
    expect(readdirSync(join(dataDir, "crashes"))).toEqual([`${id}.multipart`]);
    expect(readFileSync(join(dataDir, "crashes", `${id}.multipart`), "utf8")).toContain("minidump");
    expect((await crash("x", { "content-type": "application/json" })).status).toBe(415);
    expect((await fetch(`${base}/crash`)).status).toBe(405);
  });

  it("limits size, rate and the number kept", async () => {
    await start({ crashReports: true, maxCrashBytes: 64, crashesPerHour: 3, maxStoredCrashes: 2 });
    expect((await crash(Buffer.alloc(200, 1))).status).toBe(413);
    expect((await crash()).status).toBe(200);
    expect((await crash()).status).toBe(200);
    expect(readdirSync(join(dataDir, "crashes"))).toHaveLength(2);
    expect((await crash()).status).toBe(429);
  });
});
