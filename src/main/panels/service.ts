import { randomUUID } from "node:crypto";
import { Emitter } from "@shared/emitter";
import { addPanel, movePanel, removePanel, updatePanel, type PanelAddResult, type PanelPatch, type WebPanel } from "@shared/panels";

/** Where the panel list lives (the profile's `panels.json`). */
export interface PanelStore {
  list(): readonly WebPanel[];
  save(next: readonly WebPanel[]): void;
}

/**
 * The web panels of the profile (ADR-047): the list every normal window shows in its sidebar.
 * Edits go through the pure model (`@shared/panels`); windows follow `onChanged` (each one keeps
 * its own live pages, see `PanelHost`). A removed panel's partition is cleared by its hosts.
 */
export class PanelService {
  private readonly changes = new Emitter<void>();

  /** `forget`: clears a removed panel's partition (cookies, storage, cache). */
  constructor(
    private readonly store: PanelStore,
    private readonly forget: (id: string) => void = () => {},
  ) {}

  list(): readonly WebPanel[] {
    return this.store.list();
  }

  find(id: string): WebPanel | undefined {
    return this.store.list().find((panel) => panel.id === id);
  }

  add(input: { url: string; title?: string; mobile?: boolean }): PanelAddResult {
    const result = addPanel(this.store.list(), input, randomUUID().slice(0, 12), Date.now());
    if (result.ok) this.commit(result.panels);
    return result;
  }

  remove(id: string): void {
    if (this.find(id)) this.commit(removePanel(this.store.list(), id));
  }

  move(id: string, index: number): void {
    if (this.find(id)) this.commit(movePanel(this.store.list(), id, index));
  }

  update(id: string, patch: PanelPatch): void {
    const before = this.find(id);
    if (!before) return;
    const next = updatePanel(this.store.list(), id, patch);
    const after = next.find((panel) => panel.id === id);
    if (after && JSON.stringify(after) !== JSON.stringify(before)) this.commit(next);
  }

  /** Synced panels from another device (ADR-019): already merged by the adapter. */
  replace(next: readonly WebPanel[]): void {
    this.commit(next);
  }

  onChanged(listener: () => void): () => void {
    return this.changes.on(listener);
  }

  private commit(next: readonly WebPanel[]): void {
    const kept = new Set(next.map((panel) => panel.id));
    const removed = this.store.list().filter((panel) => !kept.has(panel.id));
    this.store.save(next);
    for (const panel of removed) this.forget(panel.id);
    this.changes.emit();
  }
}
