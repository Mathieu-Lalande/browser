import type { PermissionKind } from "@shared/types";
import { JsonFileWriter, readJsonFile } from "./json-file";

export type PermissionDecision = "allow" | "deny";
type Decisions = Map<string, Map<PermissionKind, PermissionDecision>>;

/**
 * Per-origin permission decisions. Remembered ones are persisted as `{ origin: { kind: decision } }`;
 * the others last until the browser quits (so a site cannot re-prompt in a loop).
 */
export class PermissionStore {
  private readonly saved: Decisions = new Map();
  private readonly session: Decisions = new Map();
  private readonly writer: JsonFileWriter | null;

  constructor(file: string | null) {
    this.writer = file ? new JsonFileWriter(file) : null;
    const data = file ? readJsonFile(file) : undefined;
    if (typeof data !== "object" || data === null) return;
    for (const [origin, kinds] of Object.entries(data)) {
      if (typeof kinds !== "object" || kinds === null) continue;
      for (const [kind, decision] of Object.entries(kinds)) {
        if (decision === "allow" || decision === "deny") put(this.saved, origin, kind as PermissionKind, decision);
      }
    }
  }

  get(origin: string, kind: PermissionKind): PermissionDecision | undefined {
    return this.session.get(origin)?.get(kind) ?? this.saved.get(origin)?.get(kind);
  }

  set(origin: string, kind: PermissionKind, decision: PermissionDecision, remember: boolean): Promise<void> {
    put(this.session, origin, kind, decision);
    if (!remember) return Promise.resolve();
    put(this.saved, origin, kind, decision);
    return this.writer?.save(this.toJSON()) ?? Promise.resolve();
  }

  toJSON(): Record<string, Record<string, PermissionDecision>> {
    return Object.fromEntries([...this.saved].map(([origin, kinds]) => [origin, Object.fromEntries(kinds)]));
  }
}

function put(target: Decisions, origin: string, kind: PermissionKind, decision: PermissionDecision): void {
  let kinds = target.get(origin);
  if (!kinds) target.set(origin, (kinds = new Map()));
  kinds.set(kind, decision);
}
