/**
 * Element picker of "Capture d'écran d'un élément" (ADR-031), run in an isolated world (no
 * preload, none of the page's JavaScript; ADR-003). Like the boosts' zap tool: hovering highlights
 * an element, a click picks it (trusted events only, the page never sees that click), Escape or
 * leaving the page cancels. Resolves `{ rect, page }` in document CSS pixels, or null; the
 * highlight is gone from the screen before it resolves, so it is never in the capture.
 */
import { t } from "@shared/i18n";

export const PICK_WORLD_ID = 1009;

export const pickScript = (): string => `(() => {
  if (globalThis.__browserPick) return globalThis.__browserPick;
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #3e63dd;background:rgba(62,99,221,.16);border-radius:3px;transition:all .06s;display:none";
  const hint = document.createElement("div");
  hint.textContent = ${JSON.stringify(t("captureScripts.pickHint"))};
  hint.style.cssText = "position:fixed;z-index:2147483647;left:50%;bottom:16px;transform:translateX(-50%);pointer-events:none;padding:8px 14px;border-radius:8px;background:#1b1b1f;color:#fff;font:13px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35)";
  document.documentElement.append(box, hint);
  const pick = (el) => (el instanceof Element && el !== document.documentElement ? el : null);
  const swallow = (event) => { if (event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation(); } };
  const blocked = ["mousedown", "mouseup", "pointerdown", "pointerup", "auxclick", "dblclick"];
  let finish;
  const promise = new Promise((resolve) => (finish = resolve));
  const onMove = (event) => {
    if (!event.isTrusted) return;
    const target = pick(event.target);
    if (!target) { box.style.display = "none"; return; }
    const r = target.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
  };
  const stop = (value) => {
    removeEventListener("mousemove", onMove, true);
    for (const type of blocked) removeEventListener(type, swallow, true);
    removeEventListener("click", onClick, true);
    removeEventListener("keydown", onKey, true);
    box.remove();
    hint.remove();
    globalThis.__browserPick = null;
    // Two frames: the highlight is off the screen before main captures.
    requestAnimationFrame(() => requestAnimationFrame(() => finish(value)));
  };
  const onClick = (event) => {
    if (!event.isTrusted) return;
    swallow(event);
    const el = pick(event.target);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const root = document.documentElement;
    stop({
      rect: { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height },
      page: { width: Math.max(root.scrollWidth, root.clientWidth), height: Math.max(root.scrollHeight, root.clientHeight) },
    });
  };
  const onKey = (event) => { if (event.isTrusted && event.key === "Escape") { swallow(event); stop(null); } };
  addEventListener("mousemove", onMove, true);
  for (const type of blocked) addEventListener(type, swallow, true);
  addEventListener("click", onClick, true);
  addEventListener("keydown", onKey, true);
  addEventListener("pagehide", () => stop(null), { once: true, capture: true });
  return (globalThis.__browserPick = promise);
})()`;
