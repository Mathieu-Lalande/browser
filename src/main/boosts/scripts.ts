/**
 * Page scripts of boosts (ADR-029). They run in isolated worlds through
 * `executeJavaScriptInIsolatedWorld`: they share the page's DOM, none of its JavaScript, and the
 * page gets no preload (ADR-003). Main frame only.
 */

/** Isolated worlds: 1001…1006 are taken (cosmetics, forms, media, passwords, reader). */
export const SCRIPT_WORLD_ID = 1007;
export const ZAP_WORLD_ID = 1008;

/** A boost's user script, wrapped so an exception stays in its world and is not reported to the page. */
export function userScript(code: string): string {
  return `(() => { try {\n${code}\n} catch (error) { console.warn("Boost:", error); } })(); undefined;`;
}

/**
 * The zap tool: hovering highlights an element, a click hides it and resolves the run's promise
 * with `{ selector }` (a selector matching that element only), Escape resolves `{ done: true }`
 * and removes the tool, leaving the page resolves null. Main saves the selector and runs it again.
 * Trusted events only; the page's own click handlers do not see the clicks made with the tool.
 */
export const ZAP_SCRIPT = `(() => {
  const state = (globalThis.__browserZap ??= { waiters: [], queue: [], active: false });
  const settle = (value) => {
    if (state.waiters.length) { for (const resolve of state.waiters.splice(0)) resolve(value); }
    else state.queue.push(value);
  };
  if (!state.active) {
    state.active = true;
    const unique = (selector, el) => {
      try { const found = document.querySelectorAll(selector); return found.length === 1 && found[0] === el; } catch { return false; }
    };
    const stableId = (id) => /^[A-Za-z][\\w-]{0,63}$/.test(id) && !/\\d{3,}/.test(id);
    const stableClass = (name) => /^[A-Za-z_][\\w-]{1,40}$/.test(name) && !/\\d{2,}/.test(name) && !name.startsWith("__browser");
    const part = (el) => {
      if (el.id && stableId(el.id)) return "#" + CSS.escape(el.id);
      const classes = [...el.classList].filter(stableClass).slice(0, 2).map((name) => "." + CSS.escape(name)).join("");
      return CSS.escape(el.localName) + classes;
    };
    const selectorFor = (el) => {
      const parts = [];
      for (let node = el; node && node.nodeType === 1 && node !== document.body && node !== document.documentElement; node = node.parentElement) {
        let piece = part(node);
        if (unique([piece, ...parts].join(" > "), el)) return [piece, ...parts].join(" > ");
        const parent = node.parentElement;
        if (parent && !piece.startsWith("#")) {
          const same = [...parent.children].filter((child) => child.localName === node.localName);
          if (same.length > 1) piece += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
        }
        parts.unshift(piece);
        const candidate = parts.join(" > ");
        if (unique(candidate, el)) return candidate;
      }
      const full = ["body", ...parts].join(" > ");
      return unique(full, el) ? full : null;
    };
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #e5484d;background:rgba(229,72,77,.18);border-radius:3px;transition:all .06s;display:none";
    const hint = document.createElement("div");
    hint.textContent = "Cliquez sur un élément pour le masquer. Échap pour terminer.";
    hint.style.cssText = "position:fixed;z-index:2147483647;left:50%;bottom:16px;transform:translateX(-50%);pointer-events:none;padding:8px 14px;border-radius:8px;background:#1b1b1f;color:#fff;font:13px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35)";
    document.documentElement.append(box, hint);
    let target = null;
    const pick = (el) => (el instanceof Element && el !== document.documentElement && el !== document.body ? el : null);
    const onMove = (event) => {
      if (!event.isTrusted) return;
      target = pick(event.target);
      if (!target) { box.style.display = "none"; return; }
      const r = target.getBoundingClientRect();
      Object.assign(box.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    };
    const swallow = (event) => { if (event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation(); } };
    const onClick = (event) => {
      if (!event.isTrusted) return;
      swallow(event);
      const el = pick(event.target);
      const selector = el && selectorFor(el);
      if (selector) { el.style.setProperty("display", "none", "important"); box.style.display = "none"; settle({ selector }); }
    };
    const stop = (value) => {
      state.active = false;
      removeEventListener("mousemove", onMove, true);
      for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup", "auxclick", "dblclick"]) removeEventListener(type, swallow, true);
      removeEventListener("click", onClick, true);
      removeEventListener("keydown", onKey, true);
      box.remove();
      hint.remove();
      settle(value);
    };
    const onKey = (event) => { if (event.isTrusted && event.key === "Escape") { swallow(event); stop({ done: true }); } };
    addEventListener("mousemove", onMove, true);
    for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup", "auxclick", "dblclick"]) addEventListener(type, swallow, true);
    addEventListener("click", onClick, true);
    addEventListener("keydown", onKey, true);
    addEventListener("pagehide", () => stop(null), { once: true, capture: true });
  }
  return new Promise((resolve) => {
    if (state.queue.length) resolve(state.queue.shift());
    else state.waiters.push(resolve);
  });
})()`;

