import type { FillStep } from "@shared/autofill";

/**
 * Page scripts of autofill (ADR-041), run in isolated worlds like the password ones (ADR-025): they
 * share the page's DOM but none of its JavaScript, and pages still get no preload. They only
 * describe fields (main classifies them with `@shared/autofill`) and put values main chose.
 * Main frame only.
 */

/** Isolated worlds: … 1012 translation, 1013 annotations, 1014 autofill watch, 1015 autofill fill. */
export const AUTOFILL_WATCH_WORLD_ID = 1014;
export const AUTOFILL_FILL_WORLD_ID = 1015;

/**
 * Shared by both scripts: the fields of the form holding `el` (or of the document), as
 * `FieldDescriptor`s. Values only when `withValues`, and never for passwords nor fields whose name
 * says security code (main drops a classified security code anyway).
 */
const DESCRIBE = `
const fieldsOf = (scope) => [...scope.querySelectorAll("input, select, textarea")].filter((el) => {
  if (el.disabled || el.readOnly || el.getClientRects().length === 0) return false;
  const type = (el.type || "").toLowerCase();
  return !["hidden", "submit", "button", "reset", "image", "file", "checkbox", "radio", "range", "color", "date", "datetime-local", "time", "week"].includes(type);
}).slice(0, 200);
const labelOf = (el) => {
  const own = el.labels && el.labels[0] ? el.labels[0].textContent : "";
  if (own) return own;
  const by = el.getAttribute("aria-labelledby");
  if (by) return by.split(/\\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ");
  const previous = el.previousElementSibling;
  return previous && previous.tagName === "LABEL" ? previous.textContent : "";
};
const secret = /cvc|cvv|csc|cryptogram|security.?code|card.?code|verification/i;
const describe = (el, withValues) => {
  const tag = el.tagName.toLowerCase();
  const field = {
    tag,
    type: tag === "input" ? (el.type || "text").toLowerCase() : "",
    autocomplete: el.getAttribute("autocomplete") || "",
    name: el.name || "",
    id: el.id || "",
    label: String(labelOf(el) || "").trim().slice(0, 200),
    placeholder: el.getAttribute("placeholder") || "",
    ariaLabel: el.getAttribute("aria-label") || "",
    maxLength: tag === "input" ? el.maxLength : -1,
  };
  if (tag === "select") field.options = [...el.options].slice(0, 300).map((option) => ({ value: option.value, text: (option.textContent || "").trim() }));
  const hidden = field.type === "password" || secret.test(field.name + " " + field.id + " " + field.autocomplete);
  if (withValues && !hidden) field.value = String(el.value || "").slice(0, 300);
  return field;
};
const scopeOf = (el) => (el && el.form) || (el && el.closest && el.closest("form")) || document;
`;

/**
 * Watches the document (installed once per document, state in the isolated world's globals). Each
 * run resolves with the next event, then main runs it again (null: the page went away):
 * - `submit` (trusted submit, submit button click, Enter in a field): the form's fields with values;
 * - `focus`: the first trusted focus into a form's field (once per form) or ArrowDown in a field,
 *   with the fields, the focused index and its rectangle (CSS px of the page);
 * - `blur`: focus left the fields while the page kept focus (a suggestion shown then closes).
 */
export const AUTOFILL_WATCH_SCRIPT = `(() => {
  const state = (globalThis.__browserAutofill ??= { waiters: [], queue: [], installed: false });
  const push = (event) => {
    if (state.waiters.length) { const waiters = state.waiters; state.waiters = []; for (const resolve of waiters) resolve(event); }
    else { state.queue.push(event); if (state.queue.length > 10) state.queue.shift(); }
  };
  if (!state.installed) {
    state.installed = true;
    ${DESCRIBE}
    const offered = new WeakSet();
    let lastSubmit = 0;
    const submit = (scope) => {
      const now = Date.now();
      if (now - lastSubmit < 1500) return;
      lastSubmit = now;
      const fields = fieldsOf(scope);
      if (fields.length) push({ type: "submit", fields: fields.map((el) => describe(el, true)) });
    };
    const isField = (el) => el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
    const focus = (el) => {
      const scope = scopeOf(el);
      const fields = fieldsOf(scope);
      const focused = fields.indexOf(el);
      if (focused === -1) return;
      const rect = el.getBoundingClientRect();
      push({ type: "focus", fields: fields.map((field) => describe(field, false)), focused, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
    };
    document.addEventListener("submit", (event) => { if (event.isTrusted) submit(event.target); }, true);
    document.addEventListener("click", (event) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      const button = event.target.closest('button:not([type="button"]):not([type="reset"]), input[type="submit"]');
      if (button) submit(scopeOf(button));
    }, true);
    document.addEventListener("keydown", (event) => {
      if (!event.isTrusted || !isField(event.target)) return;
      if (event.key === "Enter" && event.target instanceof HTMLInputElement) submit(scopeOf(event.target));
      else if (event.key === "ArrowDown" && !(event.target instanceof HTMLSelectElement)) focus(event.target);
    }, true);
    document.addEventListener("focusin", (event) => {
      if (!event.isTrusted || !isField(event.target)) return;
      const scope = scopeOf(event.target);
      if (offered.has(scope)) return;
      offered.add(scope);
      focus(event.target);
    }, true);
    document.addEventListener("focusout", () => {
      setTimeout(() => { if (document.hasFocus() && !isField(document.activeElement)) push({ type: "blur" }); }, 0);
    }, true);
    window.addEventListener("pagehide", () => push(null), true);
  }
  return new Promise((resolve) => {
    if (state.queue.length) resolve(state.queue.shift());
    else state.waiters.push(resolve);
  });
})()`;

/**
 * Fills the form holding the focused field (or the first form whose fields match `count`) with
 * `steps`, only if the document still has `origin`. Values are set like typing (native setter,
 * input/change events); selects pick the option main chose. Returns how many fields were set.
 */
export function autofillFillScript(origin: string, count: number, steps: readonly FillStep[]): string {
  return `((origin, count, steps) => {
  if (location.origin !== origin) return 0;
  ${DESCRIBE}
  const active = document.activeElement;
  let fields = active && active !== document.body ? fieldsOf(scopeOf(active)) : [];
  if (fields.length !== count) fields = [...document.forms].map(fieldsOf).find((list) => list.length === count) || fieldsOf(document);
  if (fields.length !== count) return 0;
  let filled = 0;
  for (const { index, value } of steps) {
    const el = fields[index];
    if (!el) continue;
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    filled++;
  }
  return filled;
})(${JSON.stringify(origin)}, ${count}, ${JSON.stringify(steps)})`;
}

/** Describes the form holding the focused field (or the page's first fillable fields), for the menu's fill. */
export const AUTOFILL_DESCRIBE_SCRIPT = `(() => {
  ${DESCRIBE}
  const active = document.activeElement;
  const scope = active && active !== document.body ? scopeOf(active) : (document.forms[0] || document);
  const fields = fieldsOf(scope);
  const focused = fields.indexOf(active);
  return { fields: fields.map((el) => describe(el, false)), focused };
})()`;
