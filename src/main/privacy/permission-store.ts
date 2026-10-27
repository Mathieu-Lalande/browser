import type { PermissionKind } from "@shared/types";
import { JsonFileWriter, readJsonFile } from "./json-file";

export type PermissionDecision = "allow" | "deny";
type Decisions = Map<string, Map<PermissionKind, PermissionDecision>>;

/** A serialized origin, e.g. `https://a.com` or `http://127.0.0.1:8080` (no path, no trailing slash). */
const ORIGIN = /^[a-z][a-z\d+.-]*:\/\/[^\s/]+$/i;

/**
 * Where a decision is kept: the requesting origin alone when it is the top-level site (the format
 * of the first version of the file, so old decisions keep applying there), else
 * `"<requesting origin> <top-level origin>"`: allowing a widget's camera inside one site must not
 * allow it inside every other site embedding it, nor on its own (audit LOW-2).
 */
export function permissionKey(origin: string, topOrigin: string = origin): string {
  return topOrigin === origin ? origin : `${origin} ${topOrigin}`;
}

function isKey(key: string): boolean {
  const parts = key.split(" ");
  return parts.length <= 2 && parts.every((part) => ORIGIN.test(part));
}

/**
 * Permission decisions per (requesting origin, top-level origin). Remembered ones are persisted as
 * `{ key: { kind: decision } }` (see `permissionKey`); the others last until the browser quits (so
 * a site cannot re-prompt in a loop).
 */
export class PermissionStore {
  private readonly saved: Decisions = new Map();
  private readonly session: Decisions = new Map();
  private readonly writer: JsonFileWriter | null;

  constructor(file: string | null) {
    this.writer = file ? new JsonFileWriter(file) : null;
    const data = file ? readJsonFile(file) : undefined;
    if (typeof data !== "object" || data === null) return;
    for (const [key, kinds] of Object.entries(data)) {
      // Old files are keyed by origin alone: those decisions now apply to that origin as the
      // top-level site only. Anything else that is not a valid key is dropped.
      if (!isKey(key) || typeof kinds !== "object" || kinds === null) continue;
      for (const [kind, decision] of Object.entries(kinds)) {
        if (decision === "allow" || decision === "deny") put(this.saved, key, kind as PermissionKind, decision);
      }
    }
  }

  get(origin: string, kind: PermissionKind, topOrigin?: string): PermissionDecision | undefined {
    const key = permissionKey(origin, topOrigin);
    return this.session.get(key)?.get(kind) ?? this.saved.get(key)?.get(kind);
  }

  set(origin: string, kind: PermissionKind, decision: PermissionDecision, remember: boolean, topOrigin?: string): Promise<void> {
    const key = permissionKey(origin, topOrigin);
    put(this.session, key, kind, decision);
    if (!remember) return Promise.resolve();
    put(this.saved, key, kind, decision);
    return this.writer?.save(this.toJSON()) ?? Promise.resolve();
  }

  toJSON(): Record<string, Record<string, PermissionDecision>> {
    return Object.fromEntries([...this.saved].map(([key, kinds]) => [key, Object.fromEntries(kinds)]));
  }
}

function put(target: Decisions, key: string, kind: PermissionKind, decision: PermissionDecision): void {
  let kinds = target.get(key);
  if (!kinds) target.set(key, (kinds = new Map()));
  kinds.set(kind, decision);
}
