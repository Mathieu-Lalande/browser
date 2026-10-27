import { randomUUID } from "node:crypto";
import type { PermissionKind, PermissionPrompt } from "@shared/types";
import { isTrustworthyOrigin } from "@shared/hosts";
import type { PermissionStore } from "./permission-store";

/** Electron permissions that map 1:1 to a prompt. `media` (camera/microphone) is handled apart. */
const PROMPTABLE: Record<string, PermissionKind> = {
  geolocation: "geolocation",
  notifications: "notifications",
  midi: "midi",
  midiSysex: "midi-sysex",
  "clipboard-read": "clipboard-read",
  "display-capture": "display-capture",
  "idle-detection": "idle-detection",
  "window-management": "window-management",
  "storage-access": "storage-access",
  "top-level-storage-access": "storage-access",
  "local-fonts": "local-fonts",
};

/** What a permission request or check is about, or null if it is never granted to pages. */
export function permissionKinds(permission: string, mediaTypes: readonly string[] = []): PermissionKind[] | null {
  if (permission === "media") {
    const kinds: PermissionKind[] = [];
    if (mediaTypes.includes("video")) kinds.push("camera");
    if (mediaTypes.includes("audio")) kinds.push("microphone");
    return kinds.length ? kinds : null;
  }
  const kind = PROMPTABLE[permission];
  return kind ? [kind] : null;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "null";
  }
}

interface Pending {
  prompt: PermissionPrompt;
  callbacks: ((granted: boolean) => void)[];
}

/**
 * Per-tab queues of permission requests waiting for the user. Only the head of a tab's queue is
 * shown (in the tab's permission bar), so background tabs simply wait until they are active.
 */
export class PermissionPrompts {
  private readonly queues = new Map<number, Pending[]>();

  constructor(
    /** The decisions, also listed and reset from the site info popover. */
    readonly store: PermissionStore,
    /** Called when a tab's head prompt changes. */
    private readonly onChange: (contentsId: number) => void,
  ) {}

  /**
   * Decide immediately from stored decisions, or queue a prompt. `topUrl`: the tab's top-level page
   * (defaults to the requesting one): decisions are per (requesting origin, top-level origin).
   */
  request(
    contentsId: number,
    requestingUrl: string,
    kinds: PermissionKind[],
    callback: (granted: boolean) => void,
    topUrl: string = requestingUrl,
  ): void {
    const origin = originOf(requestingUrl);
    if (!isTrustworthyOrigin(origin)) return callback(false);
    const top = originOf(topUrl);
    const decided = this.decide(origin, top, kinds);
    if (decided !== undefined) return callback(decided);

    const queue = this.queues.get(contentsId) ?? [];
    const same = queue.find((p) => p.prompt.origin === origin && topOf(p.prompt) === top && sameKinds(p.prompt.kinds, kinds));
    if (same) return void same.callbacks.push(callback);
    const prompt: PermissionPrompt = { id: randomUUID(), origin, kinds, ...(top !== origin ? { topOrigin: top } : {}) };
    queue.push({ prompt, callbacks: [callback] });
    this.queues.set(contentsId, queue);
    if (queue.length === 1) this.onChange(contentsId);
  }

  /** Synchronous answer for permission checks: only what was explicitly allowed counts. */
  check(requestingOrigin: string, kinds: PermissionKind[], topOrigin?: string): boolean {
    const origin = originOf(requestingOrigin);
    const top = topOrigin === undefined ? origin : originOf(topOrigin);
    return isTrustworthyOrigin(requestingOrigin) && this.decide(origin, top, kinds) === true;
  }

  current(contentsId: number): PermissionPrompt | null {
    return this.queues.get(contentsId)?.[0]?.prompt ?? null;
  }

  respond(contentsId: number, promptId: string, allow: boolean, remember: boolean): void {
    const queue = this.queues.get(contentsId);
    const index = queue?.findIndex((p) => p.prompt.id === promptId) ?? -1;
    if (!queue || index === -1) return;
    const [answered] = queue.splice(index, 1);
    const { origin, kinds } = answered.prompt;
    const top = topOf(answered.prompt);
    for (const kind of kinds) void this.store.set(origin, kind, allow ? "allow" : "deny", remember, top);
    for (const callback of answered.callbacks) callback(allow);

    // Requests from the same origin may now be decided without asking again.
    for (const pending of [...queue]) {
      const decided = this.decide(pending.prompt.origin, topOf(pending.prompt), pending.prompt.kinds);
      if (decided === undefined) continue;
      queue.splice(queue.indexOf(pending), 1);
      for (const callback of pending.callbacks) callback(decided);
    }
    if (!queue.length) this.queues.delete(contentsId);
    this.onChange(contentsId);
  }

  /** Deny everything pending for a tab (it navigated away or closed). */
  denyAll(contentsId: number): void {
    const queue = this.queues.get(contentsId);
    if (!queue) return;
    this.queues.delete(contentsId);
    for (const pending of queue) for (const callback of pending.callbacks) callback(false);
    this.onChange(contentsId);
  }

  /** true/false once every kind is decided (any deny wins), undefined if the user must be asked. */
  private decide(origin: string, top: string, kinds: PermissionKind[]): boolean | undefined {
    const decisions = kinds.map((kind) => this.store.get(origin, kind, top));
    if (decisions.includes("deny")) return false;
    return decisions.every((decision) => decision === "allow") ? true : undefined;
  }
}

/** The top-level origin a prompt was made in (its own origin when it is the top-level site). */
const topOf = (prompt: PermissionPrompt) => prompt.topOrigin ?? prompt.origin;

function sameKinds(a: PermissionKind[], b: PermissionKind[]): boolean {
  return a.length === b.length && a.every((kind) => b.includes(kind));
}
