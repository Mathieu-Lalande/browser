import { dropZone, resolveDrop, type DragItem, type DropResult, type SidebarRow, type TabFolder } from "@shared/folders";

/**
 * Pointer drag and drop of the sidebar's tab tree (ADR-022): tabs and folders in the tree, tabs
 * onto the favorites grid. The keyboard has the tab menu's "Déplacer vers le dossier…" instead.
 */

/** Pixels the pointer must travel before a press becomes a drag. */
export const DRAG_THRESHOLD = 5;
/** Vertical slack around the favorites grid that still counts as over it, px. */
const FAVORITES_SLACK = 4;
/** Room above the first row that still drops before it, px. */
const ABOVE_FIRST = 24;
/** Band at the list's top and bottom edges that scrolls it during a drag, px, and the step. */
const SCROLL_EDGE = 24;
const SCROLL_STEP = 8;

type Box = Pick<DOMRect, "top" | "bottom" | "left" | "right">;

/** Whether a press moved far enough to start a drag. */
export const passedThreshold = (from: { x: number; y: number }, to: { x: number; y: number }) => Math.hypot(to.x - from.x, to.y - from.y) >= DRAG_THRESHOLD;

/** Whether the pointer is over the favorites grid (with a little vertical slack). */
export const overBox = (box: Box, x: number, y: number) =>
  y >= box.top - FAVORITES_SLACK && y <= box.bottom + FAVORITES_SLACK && x >= box.left && x <= box.right;

/** Scroll step of the list for a pointer at `y`: up near its top, down near its bottom. */
export function autoScrollStep(list: Pick<Box, "top" | "bottom">, y: number): number {
  if (y < list.top + SCROLL_EDGE) return -SCROLL_STEP;
  if (y > list.bottom - SCROLL_EDGE) return SCROLL_STEP;
  return 0;
}

/** The drop under a vertical position, from the rows' boxes (`index` into `rows`, in order). */
export function dropFromBoxes(
  rows: readonly SidebarRow[],
  folders: readonly TabFolder[],
  item: DragItem,
  boxes: readonly { index: number; top: number; bottom: number }[],
  y: number,
): DropResult | null {
  for (const box of boxes) {
    if (y < box.top || y > box.bottom) continue;
    const row = rows[box.index];
    if (!row) return null;
    const zone = dropZone(row, (y - box.top) / Math.max(1, box.bottom - box.top), item.kind);
    return resolveDrop(rows, folders, item, box.index, zone);
  }
  const last = boxes.at(-1);
  if (last && y > last.bottom) return resolveDrop(rows, folders, item, rows.length, "after");
  const first = boxes[0];
  if (first && y < first.top && y > first.top - ABOVE_FIRST) return resolveDrop(rows, folders, item, 0, "before");
  return null;
}

/**
 * Extra indentation of the insertion line: a folder dropped "after" an open folder it lands in
 * goes one level deeper than that folder's row.
 */
export function indicatorIndent(rows: readonly SidebarRow[], drop: DropResult): number {
  const row = rows[drop.indicator.row];
  return drop.kind === "folder" && drop.indicator.edge === "after" && row?.kind === "folder" && drop.parentId === row.folder.id ? 1 : 0;
}

export interface TreeDragOptions {
  rows: () => readonly SidebarRow[];
  folders: () => readonly TabFolder[];
  /** Whether the dragged item may become a favorite (a tab with a favorite-able URL). */
  canFavorite: (item: DragItem) => boolean;
  /** A drag started. */
  onStart?: () => void;
  /** Released over the favorites grid (`favorite`) or a place in the tree. */
  onDrop: (item: DragItem, target: { favorite: true } | DropResult) => void;
}

export class TreeDrag {
  /** The tab list (rows carry `data-row-index`, draggable ones `data-drag-kind/id/label`). */
  list = $state<HTMLElement>();
  /** The favorites area (holds the `[data-drop=favorites]` grid). */
  favorites = $state<HTMLElement>();
  /** The item being dragged, with the pointer position for its ghost. */
  current = $state<{ item: DragItem; label: string; x: number; y: number } | null>(null);
  drop = $state<DropResult | null>(null);
  overFavorites = $state(false);

  #press: { x: number; y: number; item: DragItem; pointerId: number; label: string } | null = null;
  /** The click that ends a drag (or a swipe) must not activate the row under the pointer. */
  #swallowClick = false;
  readonly #options: TreeDragOptions;

  constructor(options: TreeDragOptions) {
    this.#options = options;
  }

  get canFavorite(): boolean {
    return !!this.current && this.#options.canFavorite(this.current.item);
  }

  /** Whether `kind`/`id` is the item being dragged. */
  isDragged(kind: DragItem["kind"], id: string): boolean {
    return this.current?.item.kind === kind && this.current.item.id === id;
  }

  /** Row highlighted as the drop target ("inside" a folder), or -1. */
  get insideRow(): number {
    return this.drop?.indicator.edge === "inside" ? this.drop.indicator.row : -1;
  }

  /** Where the insertion line goes, relative to the list's content (null: none). */
  indicator(): { top: number; depth: number } | null {
    const drop = this.drop;
    if (!drop || !this.list || drop.indicator.edge === "inside") return null;
    const element = this.list.querySelector<HTMLElement>(`[data-row-index="${drop.indicator.row}"]`);
    if (!element) return null;
    const depth = Number(element.dataset.depth ?? 0) + indicatorIndent(this.#options.rows(), drop);
    const top = element.offsetTop + (drop.indicator.edge === "after" ? element.offsetHeight + 1 : -1);
    return { top, depth };
  }

  /** The next click is the end of a gesture, not a click. */
  swallowNextClick(): void {
    this.#swallowClick = true;
    setTimeout(() => (this.#swallowClick = false), 0);
  }

  /** True while the click ending a gesture is expected. */
  get swallowing(): boolean {
    return this.#swallowClick;
  }

  /** Capture-phase click on the tree: eats the one ending a drag. Returns whether it did. */
  consumeClick(event: MouseEvent): boolean {
    if (!this.#swallowClick) return false;
    event.preventDefault();
    event.stopPropagation();
    this.#swallowClick = false;
    return true;
  }

  readonly pointerDown = (event: PointerEvent): void => {
    // A finger swipes between spaces or scrolls the list (ADR-031): rows are dragged with a mouse or pen.
    if (event.button !== 0 || this.current || event.pointerType === "touch") return;
    const target = event.target as HTMLElement;
    // Buttons inside a row (close, mute, chevron, more) keep their own click.
    if (target.closest("button, input")) return;
    const row = target.closest<HTMLElement>("[data-drag-kind]");
    if (!row) return;
    const kind = row.dataset.dragKind as DragItem["kind"];
    this.#press = { x: event.clientX, y: event.clientY, item: { kind, id: row.dataset.dragId! }, pointerId: event.pointerId, label: row.dataset.dragLabel ?? "" };
    window.addEventListener("pointermove", this.#onMove);
    window.addEventListener("pointerup", this.#onUp);
    window.addEventListener("pointercancel", this.cancel);
    window.addEventListener("keydown", this.#onKey, true);
  };

  readonly cancel = (): void => {
    this.#press = null;
    this.current = null;
    this.drop = null;
    this.overFavorites = false;
    window.removeEventListener("pointermove", this.#onMove);
    window.removeEventListener("pointerup", this.#onUp);
    window.removeEventListener("pointercancel", this.cancel);
    window.removeEventListener("keydown", this.#onKey, true);
  };

  #onMove = (event: PointerEvent): void => {
    const press = this.#press;
    if (!press || event.pointerId !== press.pointerId) return;
    const point = { x: event.clientX, y: event.clientY };
    if (!this.current) {
      if (!passedThreshold(press, point)) return;
      this.current = { item: press.item, label: press.label, ...point };
      this.#options.onStart?.();
    }
    this.current.x = point.x;
    this.current.y = point.y;
    const grid = this.favorites?.querySelector<HTMLElement>("[data-drop=favorites]")?.getBoundingClientRect();
    this.overFavorites = this.canFavorite && !!grid && overBox(grid, point.x, point.y);
    this.drop = this.overFavorites ? null : this.#dropAt(point.y);
    this.#autoScroll(point.y);
  };

  #onUp = (event: PointerEvent): void => {
    if (this.#press && event.pointerId !== this.#press.pointerId) return;
    if (this.current) {
      this.swallowNextClick();
      const { item } = this.current;
      if (this.overFavorites && item.kind === "tab") this.#options.onDrop(item, { favorite: true });
      else if (this.drop) this.#options.onDrop(item, this.drop);
    }
    this.cancel();
  };

  #onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.current) return;
    event.preventDefault();
    event.stopPropagation();
    this.cancel();
  };

  #dropAt(y: number): DropResult | null {
    if (!this.current || !this.list) return null;
    const boxes = [...this.list.querySelectorAll<HTMLElement>("[data-row-index]")].map((element) => {
      const rect = element.getBoundingClientRect();
      return { index: Number(element.dataset.rowIndex), top: rect.top, bottom: rect.bottom };
    });
    return dropFromBoxes(this.#options.rows(), this.#options.folders(), this.current.item, boxes, y);
  }

  #autoScroll(y: number): void {
    if (!this.list) return;
    this.list.scrollTop += autoScrollStep(this.list.getBoundingClientRect(), y);
  }
}
