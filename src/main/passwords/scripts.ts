/**
 * Page scripts of the password manager (ADR-025). Both run in isolated worlds through
 * `executeJavaScriptInIsolatedWorld`: they share the page's DOM but none of its JavaScript, so the
 * page can neither read their state nor call them, and pages still get no preload (ADR-003).
 * Main frame only: logins inside iframes are not handled.
 */

/** Isolated worlds: 1001 cosmetic filtering, 1002 unsaved input / picture-in-picture, 1003 media. */
export const CAPTURE_WORLD_ID = 1004;
export const FILL_WORLD_ID = 1005;

/**
 * Watches the document for a login (trusted events only: a script cannot fake one): a form
 * submitted, a click on a button of a form holding a filled password field, or Enter in a password
 * field. Listeners are installed once per document (state kept in the isolated world's globals).
 * Each run resolves its promise with the next capture `{ origin, username, password }` — main
 * gets it as the run's result, then runs it again — or with null when the page goes away.
 */
export const CAPTURE_SCRIPT = `(() => {
  const state = (globalThis.__browserPasswordCapture ??= { waiters: [], pending: null, installed: false });
  const settle = (value) => { const waiters = state.waiters; state.waiters = []; for (const resolve of waiters) resolve(value); };
  if (!state.installed) {
    state.installed = true;
    const textual = new Set(["", "text", "email", "tel"]);
    const snapshot = (scope) => {
      const passwords = [...scope.querySelectorAll('input[type="password"]')].filter((el) => el.value);
      if (!passwords.length) return null;
      // Sign-up and change forms repeat the new password: take it, not the old one.
      const n = passwords.length;
      const password = n >= 2 && passwords[n - 1].value === passwords[n - 2].value ? passwords[n - 2] : passwords[0];
      let username = "";
      const tagged = scope.querySelector('input[autocomplete~="username"], input[autocomplete~="email"]');
      if (tagged && tagged.value && tagged.type !== "password") username = tagged.value;
      else {
        const inputs = [...scope.querySelectorAll("input")];
        for (let i = inputs.indexOf(password) - 1; i >= 0; i--) {
          const field = inputs[i];
          if (textual.has(field.type) && field.value) { username = field.value; break; }
        }
      }
      return { origin: location.origin, username: String(username).slice(0, 512), password: String(password.value).slice(0, 1024) };
    };
    const emit = (scope) => {
      const capture = snapshot(scope || document);
      if (!capture) return;
      if (state.waiters.length) settle(capture);
      else state.pending = capture;
    };
    const scopeOf = (el) => (el && el.form) || (el && el.closest && el.closest("form")) || document;
    document.addEventListener("submit", (event) => { if (event.isTrusted) emit(event.target); }, true);
    document.addEventListener("click", (event) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      // Submit buttons only (scripted logins too): not "show password" or other plain buttons.
      const button = event.target.closest('button:not([type="button"]):not([type="reset"]), input[type="submit"]');
      if (button) emit(scopeOf(button));
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.isTrusted && event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.type === "password") emit(scopeOf(event.target));
    }, true);
    window.addEventListener("pagehide", () => settle(null), true);
  }
  return new Promise((resolve) => {
    if (state.pending) { const capture = state.pending; state.pending = null; resolve(capture); }
    else state.waiters.push(resolve);
  });
})()`;

/**
 * Puts one saved account into the page's login form, only if the document still has the entry's
 * origin. The values are set like typing would (native setter, input/change events), which is the
 * moment the page can read them: the user asked for it.
 */
export function fillScript(origin: string, username: string, password: string): string {
  return `((origin, username, password) => {
  if (location.origin !== origin) return false;
  const usable = (el) => !el.disabled && !el.readOnly && el.getClientRects().length > 0;
  const field = [...document.querySelectorAll('input[type="password"]')].find(usable);
  if (!field) return false;
  const scope = field.form || document;
  const inputs = [...scope.querySelectorAll("input")].filter(usable);
  const textual = new Set(["", "text", "email", "tel"]);
  let user = scope.querySelector('input[autocomplete~="username"]');
  if (!user || !usable(user)) {
    user = null;
    for (let i = inputs.indexOf(field) - 1; i >= 0; i--) if (textual.has(inputs[i].type)) { user = inputs[i]; break; }
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  const set = (el, value) => {
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  if (user && username) set(user, username);
  set(field, password);
  return true;
})(${JSON.stringify(origin)}, ${JSON.stringify(username)}, ${JSON.stringify(password)})`;
}
