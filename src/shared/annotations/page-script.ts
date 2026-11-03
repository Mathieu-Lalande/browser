import { HIGHLIGHT_COLORS, HIGHLIGHT_SWATCHES } from "./model";

/**
 * The page side of highlights (ADR-037), as JavaScript source shared by the desktop (an isolated
 * world, run by main) and the phone (injected into the WebView). Plain ES2018 in strings: Hermes
 * keeps no function source, and pages must get exactly this code (the unit tests evaluate it).
 *
 * Anchoring works on the page's *normalized text*: the text nodes of the body in document order
 * (scripts, styles, form fields and hidden subtrees skipped), whitespace runs collapsed to one
 * space, a space between block elements. A highlight is found again (TextQuoteSelector style):
 * 1. every exact occurrence of the quote, the best one by matching context (prefix/suffix), then
 *    by distance to the position hint;
 * 2. otherwise an approximate match (edit distance, Sellers' algorithm; head and tail for long
 *    quotes), so a page whose text changed a little keeps its highlights.
 * The match is drawn by wrapping each piece of text in `<mark data-browser-hl="id">` (styled by
 * `highlightCss`); text is moved, never parsed as HTML.
 */

/** Characters of context kept on each side (the model allows up to 64). */
export const QUOTE_CONTEXT = 32;
/** Mutations are followed with this debounce, and re-anchoring runs at most this often. */
export const REANCHOR_DEBOUNCE_MS = 600;
export const REANCHOR_MIN_GAP_MS = 1500;

/** Pure anchoring functions (no globals but `document` in `pointIndex`'s element case). */
export const ANCHOR_CORE = String.raw`
var SKIP_TAGS = /^(script|style|noscript|template|textarea|select|option|input|iframe|object|embed|svg|math|canvas|video|audio|head|title)$/;
var BLOCK_TAGS = /^(address|article|aside|blockquote|br|dd|details|dialog|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)$/;
var SPACE = /\s/;
var FUZZY_MAX_TEXT = 3000000, FUZZY_PART = 32;
function collect(root) {
  var parts = [], segs = [], index = new Map(), length = 0, space = true;
  function add(text) { parts.push(text); length += text.length; }
  function gap() { if (!space) { add(" "); space = true; } }
  function walk(element) {
    for (var node = element.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === 3) {
        var value = node.nodeValue || "", out = "", map = [];
        for (var i = 0; i < value.length; i++) {
          var c = value.charAt(i);
          if (SPACE.test(c)) { if (space) continue; out += " "; space = true; }
          else { out += c; space = false; }
          map.push(i);
        }
        if (map.length) { var seg = { node: node, start: length, map: map }; segs.push(seg); index.set(node, seg); add(out); }
      } else if (node.nodeType === 1) {
        var name = String(node.localName || "").toLowerCase();
        if (SKIP_TAGS.test(name) || (node.hasAttribute && node.hasAttribute("hidden"))) continue;
        var block = BLOCK_TAGS.test(name);
        if (block) gap();
        walk(node);
        if (block) gap();
      }
    }
  }
  walk(root);
  return { text: parts.join(""), segs: segs, index: index };
}
function lowerBound(map, offset) {
  var lo = 0, hi = map.length;
  while (lo < hi) { var mid = (lo + hi) >> 1; if (map[mid] < offset) lo = mid + 1; else hi = mid; }
  return lo;
}
/** Offset in the normalized text of a DOM boundary point (-1 when it cannot be placed). */
function pointIndex(col, container, offset) {
  if (container.nodeType === 3) {
    var seg = col.index.get(container);
    if (seg) return seg.start + lowerBound(seg.map, offset);
  }
  var probe = document.createRange();
  try { probe.setStart(container, offset); } catch (e) { return -1; }
  for (var i = 0; i < col.segs.length; i++) {
    try { if (probe.comparePoint(col.segs[i].node, 0) >= 0) return col.segs[i].start; } catch (e) { return -1; }
  }
  return col.text.length;
}
/** The quote of [start, end) in the normalized text, trimmed. */
function describe(text, start, end, context) {
  while (start < end && text.charAt(start) === " ") start++;
  while (end > start && text.charAt(end - 1) === " ") end--;
  if (end <= start) return null;
  return { exact: text.slice(start, end), prefix: text.slice(Math.max(0, start - context), start), suffix: text.slice(end, end + context), start: start };
}
function commonSuffix(a, b) { var n = 0; while (n < a.length && n < b.length && a.charAt(a.length - 1 - n) === b.charAt(b.length - 1 - n)) n++; return n; }
function commonPrefix(a, b) { var n = 0; while (n < a.length && n < b.length && a.charAt(n) === b.charAt(n)) n++; return n; }
/** Matching context characters, minus a fraction (< 1) for the distance to the position hint. */
function contextScore(text, start, end, quote) {
  var prefix = quote.prefix || "", suffix = quote.suffix || "";
  var score = commonSuffix(text.slice(Math.max(0, start - prefix.length), start), prefix) + commonPrefix(text.slice(end, end + suffix.length), suffix);
  return score - Math.abs(start - (quote.start || 0)) / (text.length + 1);
}
function locateExact(text, quote) {
  var best = null, from = 0;
  for (var count = 0; count < 1000; count++) {
    var at = text.indexOf(quote.exact, from);
    if (at < 0) break;
    var score = contextScore(text, at, at + quote.exact.length, quote);
    if (!best || score > best.score) best = { start: at, end: at + quote.exact.length, score: score, errors: 0 };
    from = at + 1;
  }
  return best;
}
/**
 * Approximate occurrences of a short pattern: ends of substrings within max edits, one per run of
 * neighboring ends (the best), at most 400 (fewest errors first).
 */
function approx(text, pattern, max) {
  var m = pattern.length, column = new Int32Array(m + 1), hits = [];
  for (var i = 0; i <= m; i++) column[i] = i;
  for (var j = 0; j < text.length; j++) {
    var c = text.charAt(j), diagonal = column[0];
    column[0] = 0;
    for (var k = 1; k <= m; k++) {
      var up = column[k], cost = diagonal + (pattern.charAt(k - 1) === c ? 0 : 1);
      if (up + 1 < cost) cost = up + 1;
      if (column[k - 1] + 1 < cost) cost = column[k - 1] + 1;
      diagonal = up;
      column[k] = cost;
    }
    if (column[m] <= max) {
      var last = hits[hits.length - 1];
      if (last && last.end === j) { if (column[m] < last.errors) { last.errors = column[m]; last.best = j + 1; } last.end = j + 1; }
      else hits.push({ end: j + 1, best: j + 1, errors: column[m] });
    }
  }
  hits = hits.map(function (hit) { return { end: hit.best, errors: hit.errors }; });
  hits.sort(function (a, b) { return a.errors - b.errors; });
  return hits.slice(0, 400);
}
function reversed(text) { return text.split("").reverse().join(""); }
/** Where an approximate match of pattern ending at end starts. */
function approxStart(text, pattern, end, max) {
  var from = Math.max(0, end - pattern.length - max), hits = approx(reversed(text.slice(from, end)), reversed(pattern), max), best = null;
  for (var i = 0; i < hits.length; i++) {
    var hit = hits[i];
    if (!best || hit.errors < best.errors || (hit.errors === best.errors && Math.abs(hit.end - pattern.length) < Math.abs(best.end - pattern.length))) best = hit;
  }
  return best ? end - best.end : Math.max(0, end - pattern.length);
}
function locateFuzzy(text, quote) {
  var exact = quote.exact, n = exact.length, candidates = [];
  if (n < 8 || text.length > FUZZY_MAX_TEXT) return null;
  if (n <= FUZZY_PART * 2) {
    var max = Math.max(1, Math.floor(n / 5)), hits = approx(text, exact, max);
    for (var i = 0; i < hits.length; i++) candidates.push({ start: approxStart(text, exact, hits[i].end, max), end: hits[i].end, errors: hits[i].errors });
  } else {
    var part = Math.floor(FUZZY_PART / 5), head = exact.slice(0, FUZZY_PART), tail = exact.slice(-FUZZY_PART);
    var heads = approx(text, head, part).map(function (hit) { return { start: approxStart(text, head, hit.end, part), errors: hit.errors }; });
    var tails = approx(text, tail, part);
    for (var t = 0; t < tails.length; t++) {
      for (var h = 0; h < heads.length; h++) {
        var length = tails[t].end - heads[h].start;
        if (length >= n * 0.75 && length <= n * 1.25) candidates.push({ start: heads[h].start, end: tails[t].end, errors: heads[h].errors + tails[t].errors + Math.round(Math.abs(length - n) / 8) });
      }
    }
  }
  var best = null;
  for (var c = 0; c < candidates.length; c++) {
    var candidate = candidates[c];
    candidate.score = contextScore(text, candidate.start, candidate.end, quote) - candidate.errors * 4;
    if (!best || candidate.score > best.score) best = candidate;
  }
  return best;
}
/** Where a quote is in the normalized text: {start, end, errors} or null. */
function locate(text, quote, fuzzy) {
  return locateExact(text, quote) || (fuzzy ? locateFuzzy(text, quote) : null);
}
`;

/**
 * Factory `(report) => api`, `report(message)` being the platform's channel to the app: main's
 * secret-prefixed console messages on the desktop, the nonce bridge on the phone. The api:
 * - `capture()`: the selection as a quote `{exact, prefix, suffix, start, rect}`, or null;
 * - `apply(marks)`: shows exactly these highlights (`HighlightMark`s: removed, recolored, anchored),
 *   then follows the page's changes to anchor missing ones; returns `{anchored, missing}` ids;
 * - `scrollTo(id)`: scrolls the highlight into view and flashes it (false when not on the page);
 * - `clear()`: removes every highlight and stops watching.
 * A trusted click on a highlight (outside links and controls, no selection) reports
 * `{type: "click", id, rect: [x, y, width, height]}` in CSS pixels of the viewport.
 */
export const ANNOTATOR_FACTORY = String.raw`(function (report) {
  "use strict";
  ${ANCHOR_CORE}
  var ATTR = "data-browser-hl", FLASH = "data-browser-hl-flash", CONTEXT = ${QUOTE_CONTEXT};
  var DEBOUNCE = ${REANCHOR_DEBOUNCE_MS}, MIN_GAP = ${REANCHOR_MIN_GAP_MS}, MAX_FUZZY_TRIES = 5;
  var ID = /^[A-Za-z0-9_-]{8,64}$/;
  var marks = {}, tries = {}, observer = null, timer = 0, last = 0, busy = false;
  function elementsOf(id) { return ID.test(id) ? document.querySelectorAll("mark[" + ATTR + "=\"" + id + "\"]") : []; }
  function present(id) { return elementsOf(id).length > 0; }
  function mutate(action) {
    busy = true;
    try { return action(); } finally { if (observer) observer.takeRecords(); busy = false; }
  }
  function decorate(element, mark) {
    element.setAttribute("data-color", mark.color);
    if (mark.hasNote) element.setAttribute("data-note", ""); else element.removeAttribute("data-note");
  }
  function wrap(col, start, end, mark) {
    var pieces = [];
    for (var i = 0; i < col.segs.length; i++) {
      var seg = col.segs[i], a = seg.start, b = seg.start + seg.map.length;
      if (b <= start) continue;
      if (a >= end) break;
      var from = Math.max(start, a) - a, to = Math.min(end, b) - a;
      pieces.push({ node: seg.node, from: seg.map[from], to: seg.map[to - 1] + 1 });
    }
    var made = 0;
    for (var k = 0; k < pieces.length; k++) {
      var piece = pieces[k], node = piece.node, parent = node.parentNode;
      if (!parent || !/\S/.test((node.nodeValue || "").slice(piece.from, piece.to))) continue;
      if (/^(table|thead|tbody|tfoot|tr|colgroup|ul|ol|dl|select)$/i.test(parent.localName || "")) continue;
      if (piece.from > 0) node = node.splitText(piece.from);
      if (piece.to - piece.from < node.nodeValue.length) node.splitText(piece.to - piece.from);
      var element = document.createElement("mark");
      element.setAttribute(ATTR, mark.id);
      decorate(element, mark);
      node.parentNode.insertBefore(element, node);
      element.appendChild(node);
      made++;
    }
    return made > 0;
  }
  function unwrap(id) {
    var list = elementsOf(id);
    for (var i = 0; i < list.length; i++) {
      var element = list[i], parent = element.parentNode;
      if (!parent) continue;
      while (element.firstChild) parent.insertBefore(element.firstChild, element);
      parent.removeChild(element);
    }
  }
  function missing() {
    return Object.keys(marks).filter(function (id) { return !present(id); }).sort(function (a, b) { return marks[a].start - marks[b].start; });
  }
  function anchorMissing() {
    var ids = missing();
    if (!ids.length || !document.body) return;
    mutate(function () {
      var col = null;
      for (var i = 0; i < ids.length; i++) {
        var mark = marks[ids[i]];
        col = col || collect(document.body);
        var fuzzy = (tries[mark.id] = (tries[mark.id] || 0) + 1) <= MAX_FUZZY_TRIES;
        var hit = locate(col.text, mark, fuzzy);
        if (hit && wrap(col, hit.start, hit.end, mark)) col = null;
      }
    });
  }
  function watch() {
    if (observer || !document.body) return;
    observer = new MutationObserver(function () {
      if (busy) return;
      clearTimeout(timer);
      timer = setTimeout(function () { last = Date.now(); anchorMissing(); }, Math.max(DEBOUNCE, last + MIN_GAP - Date.now()));
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  function status() {
    var result = { anchored: [], missing: [] };
    Object.keys(marks).forEach(function (id) { (present(id) ? result.anchored : result.missing).push(id); });
    return result;
  }
  document.addEventListener("click", function (event) {
    if (!event.isTrusted || event.button !== 0 || !event.target || !event.target.closest) return;
    var element = event.target.closest("mark[" + ATTR + "]");
    if (!element || event.target.closest("a[href],button,input,textarea,select,label,[contenteditable]")) return;
    var selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    var r = element.getBoundingClientRect();
    report({ type: "click", id: element.getAttribute(ATTR), rect: [r.left, r.top, r.width, r.height] });
  }, true);
  return {
    capture: function () {
      var selection = window.getSelection();
      if (!selection || !selection.rangeCount || selection.isCollapsed || !document.body) return null;
      var range = selection.getRangeAt(0), col = collect(document.body);
      var start = pointIndex(col, range.startContainer, range.startOffset), end = pointIndex(col, range.endContainer, range.endOffset);
      var quote = start < 0 || end <= start ? null : describe(col.text, start, end, CONTEXT);
      if (!quote) return null;
      var r = range.getBoundingClientRect();
      quote.rect = [r.left, r.top, r.width, r.height];
      return quote;
    },
    apply: function (list) {
      var next = {};
      for (var i = 0; i < list.length; i++) if (list[i] && ID.test(list[i].id)) next[list[i].id] = list[i];
      mutate(function () {
        Object.keys(marks).forEach(function (id) { if (!next[id]) unwrap(id); });
        Object.keys(next).forEach(function (id) {
          if (!marks[id]) return;
          var elements = elementsOf(id);
          if (marks[id].exact !== next[id].exact) unwrap(id);
          else for (var k = 0; k < elements.length; k++) decorate(elements[k], next[id]);
        });
      });
      marks = next;
      tries = {};
      anchorMissing();
      watch();
      return status();
    },
    scrollTo: function (id) {
      var elements = elementsOf(id);
      if (!elements.length) return false;
      elements[0].scrollIntoView({ block: "center", behavior: "smooth" });
      for (var i = 0; i < elements.length; i++) elements[i].setAttribute(FLASH, "");
      setTimeout(function () {
        var list = elementsOf(id);
        for (var k = 0; k < list.length; k++) list[k].removeAttribute(FLASH);
      }, 1600);
      return true;
    },
    clear: function () {
      mutate(function () { Object.keys(marks).forEach(unwrap); });
      marks = {};
      if (observer) observer.disconnect();
      observer = null;
      clearTimeout(timer);
    },
  };
})`;

/** The page CSS of highlights: each color light or dark (the page's color scheme), a dotted underline for notes, the "jump" flash. */
export function highlightCss(): string {
  const selector = (color: string) => `mark[data-browser-hl][data-color="${color}"]`;
  const rules = (mode: "light" | "dark") => HIGHLIGHT_COLORS.map((color) => `${selector(color)}{background:${HIGHLIGHT_SWATCHES[color][mode]} !important}`).join("");
  return (
    `mark[data-browser-hl]{color:inherit !important;padding:0 !important;margin:0 !important;border-radius:2px;cursor:pointer;` +
    `-webkit-box-decoration-break:clone;box-decoration-break:clone}` +
    rules("light") +
    `mark[data-browser-hl][data-note]{text-decoration:underline dotted !important;text-underline-offset:3px}` +
    `mark[data-browser-hl][data-browser-hl-flash]{animation:browser-hl-flash 1.5s ease-out}` +
    `@keyframes browser-hl-flash{0%,45%{outline:2px solid currentColor;outline-offset:2px}100%{outline:2px solid transparent;outline-offset:6px}}` +
    `@media (prefers-color-scheme:dark){${rules("dark")}}` +
    `@media (prefers-reduced-motion:reduce){mark[data-browser-hl][data-browser-hl-flash]{animation:none;outline:2px solid currentColor}}`
  );
}
