/**
 * The Chrome Web Store page itself (ADR-049, "store natif"): in a browser that is not Chrome, the
 * store greys out its "Ajouter à Chrome" button and shows a "Passez à Chrome" banner. Main runs a
 * small agent in an isolated world of the store's pages (never the page's own world): it hides
 * the banner and puts our "Ajouter à Browser" / "Supprimer de Browser" button where the store's
 * was, inside a closed shadow root. A click is reported to main on the console with a per-run
 * secret prefix (the page cannot read it, nor forge a trusted click), and main starts the usual
 * verified install (download, CRX3 check, permission review in the overlay).
 *
 * Pure: the page code is plain ES2018 text (`src/shared` has no DOM), evaluated by main in the
 * page's isolated world and by the unit tests on saved store pages (French and English fixtures).
 */

/** Steps of a store install, shown on the page's button, the address bar and the store bar. */
import { t } from "./i18n";

export type StoreInstallPhase = "download" | "verify" | "review" | "install";

/** A store install in progress, or the last one that failed (cleared by the next attempt). */
export type StoreInstall = { webStoreId: string; phase: StoreInstallPhase } | { webStoreId: string; phase: "error"; message: string };

export const STORE_PHASE_LABELS: Record<StoreInstallPhase, string> = {
  get download() { return t("webstorePage.downloading") },
  get verify() { return t("webstorePage.verifying") },
  get review() { return t("webstorePage.waitingApproval") },
  install: "Installation…",
};

/** What our button on a store detail page shows (computed by main, sent to the page's agent). */
export interface StoreButtonState {
  /** The extension the page is about: the agent only shows the button while its URL names it. */
  id: string;
  /** What a click asks main for; null while busy. */
  action: "install" | "remove" | null;
  label: string;
  /** A failure under the button ("Réessayer" is then the label). */
  message: string | null;
}

export function storeButtonState(id: string, installed: boolean, progress: StoreInstall | null | undefined): StoreButtonState {
  if (progress && progress.phase !== "error") return { id, action: null, label: STORE_PHASE_LABELS[progress.phase], message: null };
  if (installed) return { id, action: "remove", label: t("webstorePage.removeFromBrowser"), message: null };
  if (progress?.phase === "error") return { id, action: "install", label: "Réessayer", message: progress.message };
  return { id, action: "install", label: "Ajouter à Browser", message: null };
}

/** A click on our button, as the agent reports it. */
export interface StorePageAction {
  action: "install" | "remove";
  id: string;
}

export function parseStorePageAction(json: string): StorePageAction | null {
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [action, id] = value as unknown[];
    if ((action !== "install" && action !== "remove") || typeof id !== "string" || !/^[a-p]{32}$/.test(id)) return null;
    return { action, id };
  } catch {
    return null;
  }
}

/**
 * Finds the store's button and banner by role and text, not by class names (the store's are
 * generated and change). An expression evaluating to `{ findButton(root), findBanner(root, keep) }`:
 * - `findButton`: the store's install / remove button ("Ajouter à Chrome", "Add to Chrome",
 *   "Supprimer de Chrome"…), or null;
 * - `findBanner`: the "Passez à Chrome" / "Switch to Chrome" banner's box, never one holding `keep`.
 */
export const WEBSTORE_DOM_SOURCE = String.raw`(function () {
  var BUTTON = /^(ajouter à chrome|supprimer de chrome|retirer de chrome|add to chrome|remove from chrome|zu chrome hinzufügen|aus chrome entfernen|añadir a chrome|quitar de chrome|aggiungi a chrome|rimuovi da chrome|usar no chrome|remover do chrome|adicionar ao chrome)$/;
  var BANNER = /^(passez à chrome|passer à chrome|switch to chrome|wechseln sie zu chrome|cambia a chrome|cámbiate a chrome|passa a chrome|mude para o chrome)(\s|$)/;
  var normalize = function (value) { return String(value || "").replace(/\s+/g, " ").trim().toLowerCase(); };
  var labelOf = function (element) { return normalize(element.textContent) || normalize(element.getAttribute("aria-label")); };
  return {
    findButton: function (root) {
      var candidates = root.querySelectorAll("button, [role='button']");
      for (var i = 0; i < candidates.length; i++) if (BUTTON.test(labelOf(candidates[i]))) return candidates[i];
      return null;
    },
    findBanner: function (root, keep) {
      var elements = root.querySelectorAll("div, section, aside, p, span, header");
      var text = null;
      for (var i = 0; i < elements.length && !text; i++) {
        if (!BANNER.test(normalize(elements[i].textContent))) continue;
        // The innermost element whose text starts with the phrase.
        var inner = elements[i];
        for (var found = true; found; ) {
          found = false;
          for (var c = 0; c < inner.children.length; c++) {
            if (BANNER.test(normalize(inner.children[c].textContent))) { inner = inner.children[c]; found = true; break; }
          }
        }
        text = inner;
      }
      if (!text) return null;
      // Up to the banner's box (its "Installer Chrome" link included), never a large part of the page.
      var banner = text;
      for (var depth = 0; depth < 6; depth++) {
        var parent = banner.parentElement;
        if (!parent || parent.tagName === "BODY" || parent.tagName === "MAIN" || (keep && parent.contains(keep))) break;
        if (normalize(parent.textContent).length > 240 || parent.querySelector("h1, h2, img")) break;
        banner = parent;
      }
      return banner;
    },
  };
})()`;

const BUTTON_STYLE = [
  ":host{display:inline-flex;flex-direction:column;align-items:flex-start;gap:6px;font:500 14px/20px 'Google Sans',Roboto,Arial,sans-serif}",
  "button{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 24px;border:0;border-radius:20px;background:#0b57d0;color:#fff;font:inherit;cursor:pointer}",
  "button:hover{background:#0842a0;box-shadow:0 1px 3px rgba(0,0,0,.3)}",
  "button:focus-visible{outline:2px solid #0b57d0;outline-offset:2px}",
  "button.remove{background:#d3e3fd;color:#041e49}",
  "button.remove:hover{background:#c2d7fb}",
  "button:disabled{background:#d3e3fd;color:#041e49;cursor:progress;box-shadow:none}",
  ".spin{width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:s .8s linear infinite}",
  "@keyframes s{to{transform:rotate(1turn)}}",
  "@media (prefers-reduced-motion:reduce){.spin{animation:none}}",
  "p{max-width:360px;margin:0;color:#b3261e;font-size:13px;font-weight:400}",
].join("");

/**
 * The page side, a function `(prefix, dom) => ({ host, update(state) })`: keeps the banner hidden
 * and our button (in a closed shadow root) in place of the store's, through the store's
 * re-renders and in-app navigations (MutationObserver), and reports trusted clicks as
 * `console.debug(prefix + JSON.stringify([action, id]))`. The page's scripts see a host element,
 * never what is inside it, and cannot click it for the user (`isTrusted`).
 */
export const WEBSTORE_AGENT_SOURCE = String.raw`(function (prefix, dom) {
  var state = null;
  var rendered = "";
  var hidden = null;
  var banner = null;
  var host = document.createElement("span");
  var shadow = host.attachShadow({ mode: "closed" });
  // No innerHTML: the store enforces Trusted Types.
  var style = document.createElement("style");
  style.textContent = ${JSON.stringify(BUTTON_STYLE)};
  var button = document.createElement("button");
  button.type = "button";
  var message = document.createElement("p");
  message.setAttribute("role", "alert");
  message.hidden = true;
  shadow.append(style, button, message);
  button.addEventListener("click", function (event) {
    if (!event.isTrusted || !state || !state.action) return;
    console.debug(prefix + JSON.stringify([state.action, state.id]));
  });
  var render = function () {
    var key = JSON.stringify(state);
    if (key === rendered || !state) return;
    rendered = key;
    button.textContent = "";
    if (!state.action) {
      var spinner = document.createElement("span");
      spinner.className = "spin";
      button.appendChild(spinner);
    }
    button.appendChild(document.createTextNode(state.label));
    button.disabled = !state.action;
    button.className = state.action === "remove" ? "remove" : "";
    message.textContent = state.message || "";
    message.hidden = !state.message;
  };
  var restore = function () {
    if (hidden) hidden.style.removeProperty("display");
    hidden = null;
    if (host.isConnected) host.remove();
  };
  var hide = function (element) {
    if (element.style.getPropertyValue("display") !== "none") element.style.setProperty("display", "none", "important");
  };
  var apply = function () {
    var theirs = dom.findButton(document);
    if (!banner || !banner.isConnected) banner = dom.findBanner(document, theirs);
    if (banner) hide(banner);
    var current = state && location.pathname.indexOf(state.id) >= 0 ? theirs : null;
    if (!current) return restore();
    if (hidden !== current) {
      restore();
      hidden = current;
    }
    hide(current);
    if (current.nextElementSibling !== host) current.insertAdjacentElement("afterend", host);
    render();
  };
  var scheduled = false;
  var schedule = function () {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () {
      scheduled = false;
      apply();
    }, 50);
  };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("popstate", schedule);
  return {
    host: host,
    shadow: shadow,
    update: function (next) {
      state = next;
      apply();
    },
  };
})`;

/** The agent, run once per document (`globalThis.__browserStore`), then given `state`. */
export function webStorePageScript(prefix: string, state: StoreButtonState | null): string {
  return (
    `(globalThis.__browserStore || (globalThis.__browserStore = ${WEBSTORE_AGENT_SOURCE}(${JSON.stringify(prefix)}, ${WEBSTORE_DOM_SOURCE}))).` +
    `update(${JSON.stringify(state)});`
  );
}
