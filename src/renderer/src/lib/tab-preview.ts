import { HoverIntent } from "@shared/tab-preview";
import { api } from "./browser.svelte";
import { settings } from "./settings.svelte";

/**
 * Tab hover preview (ADR-037), chrome UI side: hover intent only. A row (tab, favorite tile, rail
 * icon) hovered for `TAB_PREVIEW.delayMs` asks main for its card; while a card is shown, the next
 * row shows at once. Scrolling, dragging, a key, a click or the window losing focus hide it.
 */

export type PreviewTarget = { kind: "tab" | "favorite"; id: string } | null;

/** Leaving a row hides the card this much later, so moving to the next row never flickers. */
const LEAVE_GRACE_MS = 60;

class PreviewHover {
  private readonly intent = new HoverIntent();
  private showTimer: ReturnType<typeof setTimeout> | undefined;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private current: HTMLElement | null = null;
  private listening = false;

  get enabled(): boolean {
    return settings.current.layout.tabHoverPreview;
  }

  enter(node: HTMLElement, target: NonNullable<PreviewTarget>): void {
    if (!this.enabled) return;
    this.listen();
    clearTimeout(this.showTimer);
    const moving = this.hideTimer !== undefined;
    clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
    this.current = node;
    const delay = moving ? 0 : this.intent.delayFor(performance.now());
    this.showTimer = setTimeout(() => this.show(node, target), delay);
  }

  leave(node: HTMLElement): void {
    if (this.current !== node) return;
    clearTimeout(this.showTimer);
    this.current = null;
    if (!this.intent.isShown) return;
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.hideTimer = undefined;
      this.hide(false);
    }, LEAVE_GRACE_MS);
  }

  /** Hides at once; `cold`: the next card waits for the full delay again. */
  hide(cold: boolean): void {
    clearTimeout(this.showTimer);
    clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
    if (cold) this.current = null;
    if (!this.intent.isShown) {
      if (cold) this.intent.hidden(performance.now(), true);
      return;
    }
    this.intent.hidden(performance.now(), cold);
    api.tabPreview.hide();
  }

  private show(node: HTMLElement, target: NonNullable<PreviewTarget>): void {
    if (this.current !== node || !node.isConnected || !this.enabled || document.hidden) return;
    const rect = node.getBoundingClientRect();
    api.tabPreview.show(target.kind, target.id, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    this.intent.shown(performance.now());
  }

  /** Anything but hovering puts the card away (installed once, on first hover). */
  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    const cold = () => this.hide(true);
    for (const type of ["keydown", "mousedown", "dragstart", "wheel"] as const) window.addEventListener(type, cold, { capture: true, passive: true });
    window.addEventListener("scroll", cold, { capture: true, passive: true });
    window.addEventListener("blur", cold);
  }
}

const hover = new PreviewHover();

/** Svelte action: `use:tabPreview={{ kind: "tab", id }}` on a row (null: no preview). */
export function tabPreview(node: HTMLElement, target: PreviewTarget) {
  let current = target;
  const onEnter = () => current && hover.enter(node, current);
  const onLeave = () => hover.leave(node);
  node.addEventListener("mouseenter", onEnter);
  node.addEventListener("mouseleave", onLeave);
  return {
    update(next: PreviewTarget) {
      current = next;
    },
    destroy() {
      node.removeEventListener("mouseenter", onEnter);
      node.removeEventListener("mouseleave", onLeave);
      hover.leave(node);
    },
  };
}

/** Whether rows should drop their native tooltip (the card says the same, better). */
export const previewsEnabled = () => hover.enabled;
