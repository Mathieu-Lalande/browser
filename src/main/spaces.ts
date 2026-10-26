import { randomUUID } from "node:crypto";
import { session, type BaseWindow, type Session } from "electron";
import { DEFAULT_SPACE, addSpace, cycleSpace, neighborSpace, removeSpace, spacePartition, updateSpace } from "@shared/spaces";
import type { Bounds, BrowserState, SpaceId, SpaceInfo, SpaceInput, TabId } from "@shared/types";
import { hardenSession } from "./security";
import type { SessionWindow } from "./storage/session";
import { TabManager, type TabManagerHooks, type TabOptions } from "./tabs";

/** What changed in the space list, beyond names/icons/colors. */
export interface SpaceChange {
  /** A space was deleted; windows showing it switch to `fallback`. */
  removed?: { id: SpaceId; fallback: SpaceId };
  /** A space's isolation changed: its tabs move to its new session. */
  sessionChanged?: SpaceId;
}

/**
 * The spaces of the profile, shared by every window (each window shows one of them at a time,
 * with its own tabs). Persisted in session.json with the windows.
 */
class SpaceRegistry {
  private spaces: SpaceInfo[] = [{ ...DEFAULT_SPACE }];
  private readonly listeners = new Set<(change: SpaceChange) => void>();

  init(spaces: readonly SpaceInfo[] | undefined): void {
    if (spaces?.length) this.spaces = [...spaces];
  }

  list(): SpaceInfo[] {
    return this.spaces.map((space) => ({ ...space }));
  }

  get(id: SpaceId): SpaceInfo | undefined {
    return this.spaces.find((space) => space.id === id);
  }

  create(input: SpaceInput = {}): SpaceInfo | null {
    const next = addSpace(this.spaces, randomUUID(), input);
    if (!next) return null;
    this.spaces = next;
    this.notify({});
    return { ...next[next.length - 1] };
  }

  update(id: SpaceId, input: SpaceInput): void {
    const before = this.get(id);
    if (!before) return;
    this.spaces = updateSpace(this.spaces, id, input);
    this.notify(before.isolated !== this.get(id)?.isolated ? { sessionChanged: id } : {});
  }

  /** Deletes a space (never the last one): its tabs are closed in every window. */
  remove(id: SpaceId): void {
    const space = this.get(id);
    const fallback = neighborSpace(this.spaces, id);
    if (!space || !fallback || this.spaces.length <= 1) return;
    this.spaces = removeSpace(this.spaces, id);
    this.notify({ removed: { id, fallback } });
    // An isolated space takes its cookies, storage and cache with it.
    if (space.isolated) {
      const partition = session.fromPartition(spacePartition(id));
      void partition.clearStorageData().catch(() => {});
      void partition.clearCache().catch(() => {});
    }
  }

  /**
   * Session of a space's pages: undefined (the default session) unless the space is isolated, in
   * which case its own persistent partition, hardened like the default one before any page uses it.
   */
  sessionFor(id: SpaceId): Session | undefined {
    if (!this.get(id)?.isolated) return undefined;
    return hardenSession(session.fromPartition(spacePartition(id)));
  }

  onChange(listener: (change: SpaceChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(change: SpaceChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }
}

export const spaces = new SpaceRegistry();

/**
 * The spaces of one window: a TabManager per space (created when the space is first shown), only
 * the active one visible. TabManager stays unaware of spaces; this class composes them.
 */
export class SpaceManager {
  private readonly managers = new Map<SpaceId, TabManager>();
  private activeId: SpaceId;
  private bounds: Bounds = { x: 0, y: 0, width: 0, height: 0 };
  private options: Partial<TabOptions> = {};
  private emitScheduled = false;
  private destroyed = false;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly window: BaseWindow,
    private readonly onChange: (state: BrowserState) => void,
    private readonly hooks: TabManagerHooks = {},
    saved?: SessionWindow,
  ) {
    const list = spaces.list();
    this.activeId = saved && spaces.get(saved.activeSpaceId) ? saved.activeSpaceId : list[0].id;
    for (const entry of saved?.spaces ?? []) {
      if (spaces.get(entry.spaceId)) this.managerFor(entry.spaceId, false).restore(entry);
    }
    this.managerFor(this.activeId);
    this.unsubscribe = spaces.onChange((change) => this.spacesChanged(change));
  }

  /** The TabManager of the space on screen. */
  get active(): TabManager {
    return this.managerFor(this.activeId);
  }

  get activeSpaceId(): SpaceId {
    return this.activeId;
  }

  getState(): BrowserState {
    return { ...this.active.getState(), spaces: spaces.list(), activeSpaceId: this.activeId };
  }

  snapshot(): SessionWindow {
    const known = spaces.list().filter((space) => this.managers.has(space.id));
    return {
      activeSpaceId: this.activeId,
      spaces: known.map((space) => ({ spaceId: space.id, ...this.managers.get(space.id)!.snapshot() })),
    };
  }

  switchTo(id: SpaceId): void {
    if (id === this.activeId || !spaces.get(id)) return;
    this.managers.get(this.activeId)?.setVisible(false);
    this.activeId = id;
    this.managerFor(id).setVisible(true);
    this.emit();
  }

  /** Next/previous space (wrapping), e.g. Ctrl+Alt+→. */
  switchBy(delta: number): void {
    const id = cycleSpace(spaces.list(), this.activeId, delta);
    if (id) this.switchTo(id);
  }

  /** The n-th space; a negative index counts from the end. */
  switchIndex(index: number): void {
    const list = spaces.list();
    const space = index < 0 ? list.at(index) : list[index];
    if (space) this.switchTo(space.id);
  }

  /**
   * Moves a tab to another space of this window. Same session: the live page moves along;
   * otherwise it reloads in the target space's session.
   */
  moveTab(tabId: TabId, spaceId: SpaceId): void {
    if (!spaces.get(spaceId)) return;
    const source = [...this.managers.values()].find((manager) => manager.getState().tabs.some((tab) => tab.id === tabId));
    const target = this.managerFor(spaceId, false);
    if (!source || source === target) return;
    const released = source.release(tabId);
    if (released) target.adopt(released);
  }

  /** Preferences for every space's tabs (settings), including spaces opened later. */
  configure(options: Partial<TabOptions>): void {
    this.options = { ...this.options, ...options };
    for (const manager of this.managers.values()) manager.configure(options);
  }

  setBounds(bounds: Bounds): void {
    this.bounds = bounds;
    for (const manager of this.managers.values()) manager.setBounds(bounds);
  }

  /** Re-sends the state, e.g. after a bookmark change. */
  refresh(): void {
    for (const manager of this.managers.values()) manager.refresh();
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe();
    for (const manager of this.managers.values()) manager.destroy();
    this.managers.clear();
  }

  /** The space's TabManager, created on demand (with a start page tab unless `populate` is false). */
  private managerFor(id: SpaceId, populate = true): TabManager {
    let manager = this.managers.get(id);
    if (!manager) {
      manager = new TabManager(this.window, () => this.emit(), this.hooks, {
        session: spaces.sessionFor(id),
        visible: id === this.activeId,
      });
      manager.configure(this.options);
      manager.setBounds(this.bounds);
      this.managers.set(id, manager);
      if (populate) manager.create();
    } else if (populate && manager.getState().tabs.length === 0) {
      manager.create();
    }
    return manager;
  }

  private spacesChanged(change: SpaceChange): void {
    if (change.removed) {
      const { id, fallback } = change.removed;
      if (this.activeId === id) this.switchTo(fallback);
      this.managers.get(id)?.destroy();
      this.managers.delete(id);
    }
    if (change.sessionChanged) this.managers.get(change.sessionChanged)?.setSession(spaces.sessionFor(change.sessionChanged));
    this.emit();
  }

  private emit(): void {
    if (this.emitScheduled) return;
    this.emitScheduled = true;
    queueMicrotask(() => {
      this.emitScheduled = false;
      if (!this.destroyed) this.onChange(this.getState());
    });
  }
}
