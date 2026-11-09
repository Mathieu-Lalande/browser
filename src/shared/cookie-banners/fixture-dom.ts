import type { BannerDom } from "./agent";

/**
 * A tiny HTML document for the cookie banner tests (Vitest runs without a DOM): enough HTML to
 * write CMP fixtures, a CSS selector subset (tags, `#id`, `.class`, `[attr]`, `[attr=v]`,
 * `[attr^=v]`, `[attr*=v]`, descendant and `>` combinators, lists) and the agent's port. Clicking
 * a fixture button applies its test-only `data-closes` / `data-opens` attributes (selectors).
 * A shadow root (`host >>> inner`) is modelled as the host's own subtree.
 */

export interface FakeElement {
  tag: string;
  attrs: Map<string, string>;
  children: FakeElement[];
  text: string;
  parent: FakeElement | null;
}

const VOID = new Set(["br", "img", "input", "meta", "link", "hr"]);

export function parseHtml(html: string): FakeElement {
  const root: FakeElement = { tag: "#root", attrs: new Map(), children: [], text: "", parent: null };
  let current = root;
  const token = /<!--[\s\S]*?-->|<\/([a-z\d-]+)\s*>|<([a-z\d-]+)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/gi;
  for (const [, close, open, rawAttrs, selfClosing, text] of html.matchAll(token)) {
    if (close) {
      let node: FakeElement | null = current;
      while (node && node.tag !== close.toLowerCase()) node = node.parent;
      if (node?.parent) current = node.parent;
    } else if (open) {
      const attrs = new Map<string, string>();
      for (const [, name, v1, v2, v3] of (rawAttrs ?? "").matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        attrs.set(name.toLowerCase(), v1 ?? v2 ?? v3 ?? "");
      }
      const element: FakeElement = { tag: open.toLowerCase(), attrs, children: [], text: "", parent: current };
      current.children.push(element);
      if (!selfClosing && !VOID.has(element.tag)) current = element;
    } else if (text?.trim()) {
      current.text += text.trim();
    }
  }
  return root;
}

const textOf = (element: FakeElement): string => [element.text, ...element.children.map(textOf)].filter(Boolean).join(" ");

const descendants = (root: FakeElement): FakeElement[] => root.children.flatMap((child) => [child, ...descendants(child)]);

interface Compound {
  tag?: string;
  ids: string[];
  classes: string[];
  attrs: { name: string; op?: string; value?: string }[];
}

function parseCompound(text: string): Compound {
  const compound: Compound = { ids: [], classes: [], attrs: [] };
  for (const [part] of text.matchAll(/^[a-z\d*-]+|#[\w-]+|\.[\w-]+|\[[^\]]+\]/gi)) {
    if (part[0] === "#") compound.ids.push(part.slice(1));
    else if (part[0] === ".") compound.classes.push(part.slice(1));
    else if (part[0] === "[") {
      const [, name = "", op, value] = /^\[\s*([\w-]+)\s*(?:([*^]?=)\s*["']?([^"'\]]*)["']?)?\s*\]$/.exec(part) ?? [];
      compound.attrs.push({ name: name.toLowerCase(), op, value });
    } else if (part !== "*") compound.tag = part.toLowerCase();
  }
  return compound;
}

function matchesCompound(element: FakeElement, compound: Compound): boolean {
  if (compound.tag && element.tag !== compound.tag) return false;
  if (compound.ids.some((id) => element.attrs.get("id") !== id)) return false;
  const classes = (element.attrs.get("class") ?? "").split(/\s+/);
  if (compound.classes.some((name) => !classes.includes(name))) return false;
  return compound.attrs.every(({ name, op, value = "" }) => {
    const actual = element.attrs.get(name);
    if (actual === undefined) return false;
    if (op === "=") return actual === value;
    if (op === "^=") return actual.startsWith(value);
    if (op === "*=") return actual.includes(value);
    return true;
  });
}

/** Whether `element` matches a complex selector (compounds joined by descendant / `>` combinators). */
function matchesComplex(element: FakeElement, selector: string): boolean {
  const parts = selector.trim().replace(/\s*>\s*/g, " > ").split(/\s+/);
  const check = (node: FakeElement | null, index: number): boolean => {
    if (!node || node.tag === "#root") return false;
    if (!matchesCompound(node, parseCompound(parts[index]))) return false;
    if (index === 0) return true;
    if (parts[index - 1] === ">") return check(node.parent, index - 2);
    for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) if (check(ancestor, index - 1)) return true;
    return false;
  };
  return check(element, parts.length - 1);
}

export function querySelectorAll(root: FakeElement, selectorList: string): FakeElement[] {
  const selectors = selectorList.split(",").map((selector) => selector.trim());
  return descendants(root).filter((element) => selectors.some((selector) => matchesComplex(element, selector)));
}

function isVisible(element: FakeElement): boolean {
  for (let node: FakeElement | null = element; node && node.tag !== "#root"; node = node.parent) {
    if (node.attrs.has("hidden") || /display\s*:\s*none/.test(node.attrs.get("style") ?? "")) return false;
  }
  return true;
}

export interface FixturePage {
  dom: BannerDom<FakeElement>;
  root: FakeElement;
  /** Labels of the elements clicked, in order. */
  clicks: string[];
  /** What `hide` was asked to hide. */
  hidden: string[];
  /** Appends HTML to the document once the clock reaches `at` ms (a late banner). */
  appendAt(at: number, html: string): void;
}

/** A fixture page whose clock advances by the time the agent waits. */
export function fixturePage(html: string): FixturePage {
  const root = parseHtml(html);
  let clock = 0;
  const clicks: string[] = [];
  const hidden: string[] = [];
  const timers: { at: number; run: () => void }[] = [];
  const label = (element: FakeElement) =>
    textOf(element) || element.attrs.get("aria-label") || element.attrs.get("title") || element.attrs.get("value") || "";
  const one = (selector: string): FakeElement[] => {
    const [host, inner] = selector.split(">>>").map((part) => part.trim());
    if (inner === undefined) return querySelectorAll(root, selector);
    return querySelectorAll(root, host).flatMap((element) => querySelectorAll(element, inner));
  };
  return {
    root,
    clicks,
    hidden,
    appendAt(at, fragment) {
      timers.push({
        at,
        run: () => {
          for (const child of parseHtml(fragment).children) {
            child.parent = root;
            root.children.push(child);
          }
        },
      });
    },
    dom: {
      query: (selectorList) => selectorList.split(",").map((part) => part.trim()).filter(Boolean).flatMap(one),
      visible: isVisible,
      label,
      click(element) {
        clicks.push(label(element));
        for (const target of querySelectorAll(root, element.attrs.get("data-closes") ?? "#none")) target.attrs.set("hidden", "");
        for (const target of querySelectorAll(root, element.attrs.get("data-opens") ?? "#none")) target.attrs.delete("hidden");
      },
      hide(selectors) {
        hidden.push(...selectors);
      },
      async changed(ms) {
        clock += Math.max(ms, 1);
        for (const timer of timers.filter((item) => item.at <= clock)) {
          timers.splice(timers.indexOf(timer), 1);
          timer.run();
        }
      },
      now: () => clock,
    },
  };
}
