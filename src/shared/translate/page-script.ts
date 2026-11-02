import { MAX_SEGMENT_CHARS } from "./segments";

/**
 * The page side of translation (ADR-036), as JavaScript source shared by the desktop (run in an
 * isolated world by main) and the phone (injected into the WebView). Plain ES2018 in a string:
 * Hermes keeps no function source, and the page must get exactly this code.
 *
 * `TRANSLATE_WALKER` evaluates to a factory; the object it returns:
 * - `info()`: the page's declared language (`<html lang>`, `Content-Language`);
 * - `start()`: walks the body's text nodes, skipping scripts, styles, code, `pre`, form fields,
 *   editable content, `aria-hidden`, `translate="no"`/`.notranslate`, SVG and MathML, then watches
 *   for new content (MutationObserver, debounced, capped);
 * - `next(maxChars, maxCount)`: the next texts to translate `[[id, text], …]`, those in the
 *   viewport first, each sent once;
 * - `apply([[id, text], …])`: writes translations with `nodeValue` (never HTML), only where the
 *   node still holds what was sent, keeping the original's surrounding spaces;
 * - `wait()`: resolves true once new texts are waiting, false when stopped or the page goes;
 * - `restore()`: puts every original text back and stops watching.
 */

/** Text nodes followed per page at most; new content beyond it stays untranslated. */
export const MAX_PAGE_NODES = 20_000;
/** Debounce of new content before it is translated, in ms. */
export const MUTATION_DEBOUNCE_MS = 400;

export const TRANSLATE_WALKER = `(function () {
  var MAX_NODES = ${MAX_PAGE_NODES}, MAX_TEXT = ${MAX_SEGMENT_CHARS}, DEBOUNCE = ${MUTATION_DEBOUNCE_MS};
  var SKIP = /^(script|style|noscript|code|pre|kbd|samp|var|textarea|input|select|option|template|iframe|canvas|svg|math|object|embed|audio|video)$/i;
  var LETTER = /\\p{L}/u;
  var entries = new Map(), byNode = new WeakMap(), queue = [], nextId = 1;
  var on = false, observer = null, waiter = null, timer = 0;
  function skipped(el) {
    if (!el || el.isContentEditable) return true;
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (SKIP.test(e.localName)) return true;
      if (e.getAttribute("aria-hidden") === "true" || e.getAttribute("translate") === "no") return true;
      if (e.classList && e.classList.contains("notranslate")) return true;
    }
    return false;
  }
  function consider(node) {
    if (entries.size >= MAX_NODES) return;
    var value = node.nodeValue, known = byNode.get(node);
    if (known && (value === known.translated || value === known.original)) return;
    if (!value || !LETTER.test(value) || skipped(node.parentElement)) return;
    var m = /^(\\s*)([\\s\\S]*?)(\\s*)$/.exec(value);
    if (!m[2] || m[2].length > MAX_TEXT) return;
    var entry = known || { id: nextId++, node: node };
    entry.original = value; entry.lead = m[1]; entry.core = m[2]; entry.trail = m[3];
    entry.translated = null; entry.sent = false;
    if (!known) { entries.set(entry.id, entry); byNode.set(node, entry); }
    queue.push(entry);
  }
  function scan(root) {
    if (!root) return;
    if (root.nodeType === 3) return consider(root);
    if (root.nodeType !== 1 || skipped(root)) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), node;
    while ((node = walker.nextNode())) consider(node);
  }
  function settle() {
    timer = 0;
    if (waiter && queue.length) { var resolve = waiter; waiter = null; resolve(true); }
  }
  function onMutations(records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === "characterData") consider(r.target);
      else for (var j = 0; j < r.addedNodes.length; j++) scan(r.addedNodes[j]);
    }
    if (queue.length && !timer) timer = setTimeout(settle, DEBOUNCE);
  }
  function inView(entry) {
    var el = entry.node.parentElement;
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  }
  function stop(value) {
    on = false;
    if (observer) observer.disconnect();
    observer = null;
    clearTimeout(timer); timer = 0;
    if (waiter) { var resolve = waiter; waiter = null; resolve(value); }
  }
  addEventListener("pagehide", function () { stop(false); });
  return {
    info: function () {
      var meta = document.querySelector('meta[http-equiv="content-language" i]');
      return { lang: document.documentElement.lang || "", contentLanguage: meta ? meta.content || "" : "", translated: on };
    },
    start: function () {
      if (on) return true;
      on = true;
      queue = [];
      entries.forEach(function (entry) { queue.push(entry); entry.sent = false; entry.translated = null; entry.original = entry.node.nodeValue; });
      scan(document.body);
      observer = new MutationObserver(onMutations);
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true });
      return true;
    },
    next: function (maxChars, maxCount) {
      if (!on) return [];
      queue = queue.filter(function (entry) { return !entry.sent && entry.node.isConnected && entry.node.nodeValue === entry.original; });
      var head = queue.slice(0, 2000), first = [], rest = [];
      head.forEach(function (entry) { (inView(entry) ? first : rest).push(entry); });
      var picked = [], chars = 0, ordered = first.concat(rest);
      for (var i = 0; i < ordered.length && picked.length < maxCount; i++) {
        var entry = ordered[i];
        if (entry.sent) continue;
        if (picked.length && chars + entry.core.length > maxChars) break;
        entry.sent = true; chars += entry.core.length;
        picked.push([entry.id, entry.core]);
      }
      return picked;
    },
    apply: function (pairs) {
      var done = 0;
      for (var i = 0; i < pairs.length; i++) {
        var entry = entries.get(pairs[i][0]), text = pairs[i][1];
        if (!on || !entry || typeof text !== "string" || !entry.node.isConnected || entry.node.nodeValue !== entry.original) continue;
        entry.translated = entry.lead + text + entry.trail;
        entry.node.nodeValue = entry.translated;
        done++;
      }
      if (observer) observer.takeRecords();
      return done;
    },
    wait: function () {
      if (!on) return Promise.resolve(false);
      if (waiter) waiter(false);
      return new Promise(function (resolve) { waiter = resolve; if (queue.some(function (e) { return !e.sent; })) settle(); });
    },
    restore: function () {
      stop(false);
      var restored = 0;
      entries.forEach(function (entry) {
        if (entry.translated !== null && entry.node.nodeValue === entry.translated) { entry.node.nodeValue = entry.original; restored++; }
        entry.translated = null; entry.sent = false;
      });
      queue = [];
      return restored;
    }
  };
})`;

/** The declared language without creating the walker (desktop: after each load). */
export const PAGE_LANGUAGE_SCRIPT = `(function () {
  var meta = document.querySelector('meta[http-equiv="content-language" i]');
  return { lang: document.documentElement.lang || "", contentLanguage: meta ? meta.content || "" : "" };
})()`;
