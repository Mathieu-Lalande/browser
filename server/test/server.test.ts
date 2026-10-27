import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
