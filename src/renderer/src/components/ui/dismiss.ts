import type { ActionReturn } from "svelte/action";

/**
 * `use:dismiss`: closes a popover or menu on Escape and, optionally, on a press outside it.
 *
 * - `escape: "window"` (default) listens on the whole window: a popover whose focused button just
 *   went away (a confirmed action) leaves the focus on the page body, outside the popover.
 * - `escape: "node"` only hears Escape from inside the element (a menu in the sidebar), and stops
 *   it there so the chrome's other Escape handlers do not run too.
 * - `outside`: a pointer press outside the element dismisses too (popovers of the overlay layer
 *   have the overlay's backdrop for that instead).
 */
export interface DismissOptions {
  onDismiss: (reason: "escape" | "outside") => void;
  escape?: "window" | "node" | false;
  outside?: boolean;
  /** Listens only while true (a menu that is closed has nothing to dismiss). */
  enabled?: boolean;
}

export function dismiss(node: HTMLElement, initial: DismissOptions): ActionReturn<DismissOptions> {
  let options = initial;

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || options.enabled === false) return;
    event.preventDefault();
    event.stopPropagation();
    options.onDismiss("escape");
  };
  const onPointerdown = (event: PointerEvent) => {
    if (!options.outside || options.enabled === false || node.contains(event.target as Node)) return;
    options.onDismiss("outside");
  };

  let target: Window | HTMLElement | null = null;
  const listen = () => {
    const next = options.escape === false ? null : options.escape === "node" ? node : window;
    if (next === target) return;
    target?.removeEventListener("keydown", onKeydown as EventListener);
    next?.addEventListener("keydown", onKeydown as EventListener);
    target = next;
  };
  listen();
  window.addEventListener("pointerdown", onPointerdown);

  return {
    update(next) {
      options = next;
      listen();
    },
    destroy() {
      target?.removeEventListener("keydown", onKeydown as EventListener);
      window.removeEventListener("pointerdown", onPointerdown);
    },
  };
}
