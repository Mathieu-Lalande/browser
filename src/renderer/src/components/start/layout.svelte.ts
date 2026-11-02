import {
  addWidget,
  applyPreset,
  defaultWidgets,
  moveWidget,
  removeWidget,
  resizeWidget,
  shiftWidget,
  updateWidgetOptions,
  type PresetId,
  type StartWidget,
  type WidgetKind,
  type WidgetSize,
} from "@shared/start-widgets";
import { settings } from "../../lib/settings.svelte";

/** Pause after the last keystroke before notes and tasks are saved. */
const SAVE_DELAY_MS = 400;

/**
 * The start page's widget list (ADR-034), edited through the pure operations of
 * `@shared/start-widgets`. Edits show at once; they reach the settings right away, or after a
 * pause while typing. A private window keeps its edits in memory only: nothing is saved.
 */
export class StartLayout {
  /** Edits not saved yet (typing), or every edit of a private window. */
  private draft = $state<StartWidget[] | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly isPrivate: () => boolean) {}

  get widgets(): StartWidget[] {
    return this.draft ?? settings.current.startPage.widgets;
  }

  add(kind: WidgetKind, index?: number): string | null {
    const before = new Set(this.widgets.map((widget) => widget.id));
    this.edit((widgets) => addWidget(widgets, kind, index));
    return this.widgets.find((widget) => !before.has(widget.id))?.id ?? null;
  }

  remove(id: string): void {
    this.edit((widgets) => removeWidget(widgets, id));
  }

  move(id: string, index: number): void {
    this.edit((widgets) => moveWidget(widgets, id, index));
  }

  shift(id: string, delta: number): void {
    this.edit((widgets) => shiftWidget(widgets, id, delta));
  }

  resize(id: string, size: WidgetSize): void {
    this.edit((widgets) => resizeWidget(widgets, id, size));
  }

  /** `typing`: saved after a pause (notes, tasks), not on every keystroke. */
  setOptions(id: string, patch: Record<string, unknown>, typing = false): void {
    this.edit((widgets) => updateWidgetOptions(widgets, id, patch), typing);
  }

  preset(id: PresetId): void {
    this.edit((widgets) => applyPreset(widgets, id));
  }

  reset(): void {
    this.edit(() => defaultWidgets());
  }

  /** Saves pending edits now (the page is leaving). */
  flush(): void {
    clearTimeout(this.timer);
    if (!this.draft || this.isPrivate()) return;
    const widgets = this.draft;
    this.draft = null;
    // A plain copy: Svelte state proxies cannot cross IPC.
    settings.update({ startPage: { widgets: $state.snapshot(widgets) } });
  }

  private edit(update: (widgets: StartWidget[]) => StartWidget[], typing = false): void {
    this.draft = update(this.widgets);
    if (this.isPrivate()) return;
    clearTimeout(this.timer);
    if (typing) this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
    else this.flush();
  }
}
