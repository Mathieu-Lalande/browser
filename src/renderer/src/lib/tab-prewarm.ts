import { PREWARM_HOVER_MS } from "@shared/tab-prewarm";
import { api } from "./browser.svelte";

/**
 * Smart preloading (ADR-057), chrome UI side: a sleeping tab's row hovered for
 * `PREWARM_HOVER_MS` asks main to wake it in the background. Main decides (setting, energy saver,
 * memory, one at a time); the row only reports the intent.
 */
export function tabPrewarm(node: HTMLElement, id: string | null) {
  let current = id;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const onEnter = () => {
    cancel();
    const target = current;
    if (target) timer = setTimeout(() => api.tabs.prewarm(target), PREWARM_HOVER_MS);
  };
  node.addEventListener("mouseenter", onEnter);
  node.addEventListener("mouseleave", cancel);
  node.addEventListener("mousedown", cancel);
  return {
    update(next: string | null) {
      current = next;
      if (!next) cancel();
    },
    destroy() {
      cancel();
      node.removeEventListener("mouseenter", onEnter);
      node.removeEventListener("mouseleave", cancel);
      node.removeEventListener("mousedown", cancel);
    },
  };
}
