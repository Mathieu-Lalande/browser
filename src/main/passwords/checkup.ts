import { createHash } from "node:crypto";
import { app, session } from "electron";
import {
  BREACH_CONCURRENCY,
  BREACH_RANGE_URL,
  BREACH_TIMEOUT_MS,
  buildReport,
  parseRange,
  rangeParts,
  type CheckupReport,
} from "@shared/password-checkup";
import { ASSETS_PARTITION } from "../start-image";
import { currentVault } from "./vault";

/**
 * Password checkup (ADR-059), in main: the vault never leaves it. Weak and reused passwords are
 * found locally; breaches through the range API (5 hex characters of the SHA-1 sent, padded
 * answer, local match), only when the user asked, through the in-memory assets session (no
 * cookies). Dev-only hook `BROWSER_TEST_BREACH_URL`: a local fake range service.
 */

const MAX_BYTES = 2 * 1024 * 1024;

const rangeUrl = (): string => (!app.isPackaged && process.env.BROWSER_TEST_BREACH_URL) || BREACH_RANGE_URL;

export type RangeFetch = (prefix: string) => Promise<string>;

const fetchRange: RangeFetch = async (prefix) => {
  const response = await session.fromPartition(ASSETS_PARTITION).fetch(`${rangeUrl()}${prefix}`, {
    credentials: "omit",
    headers: { "Add-Padding": "true" },
    signal: AbortSignal.timeout(BREACH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > MAX_BYTES) throw new Error("Response too large");
  return body;
};

/** Breach counts by entry id; throws when the service cannot be reached. */
export async function breachCounts(entries: readonly { id: string; password: string }[], fetch: RangeFetch = fetchRange): Promise<Map<string, number>> {
  const byPrefix = new Map<string, { id: string; suffix: string }[]>();
  for (const entry of entries) {
    if (!entry.password) continue;
    const { prefix, suffix } = rangeParts(createHash("sha1").update(entry.password, "utf8").digest("hex"));
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), { id: entry.id, suffix }]);
  }
  const counts = new Map<string, number>();
  const queue = [...byPrefix];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [prefix, wanted] = next;
      const range = parseRange(await fetch(prefix));
      for (const { id, suffix } of wanted) counts.set(id, range.get(suffix) ?? 0);
    }
  };
  await Promise.all(Array.from({ length: Math.min(BREACH_CONCURRENCY, queue.length) }, worker));
  return counts;
}

/** The checkup of the current vault; `breaches` false keeps everything on the device. */
export async function checkPasswords(breaches: boolean, fetch?: RangeFetch): Promise<CheckupReport> {
  const entries = currentVault().entries.map(({ id, password }) => ({ id, password }));
  if (!breaches) return buildReport(entries, null, "skipped", Date.now());
  try {
    return buildReport(entries, await breachCounts(entries, fetch), "ok", Date.now());
  } catch {
    return buildReport(entries, null, "failed", Date.now());
  }
}
