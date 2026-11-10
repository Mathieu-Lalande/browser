/**
 * The `chrome.*` APIs the browser adds for extensions (ADR-053), as plain data and pure functions:
 * match patterns, what an extension may read of a tab, `tabs.query`, toolbar button state
 * (`chrome.action`), context menu items (`chrome.contextMenus`) and their merge into the page
 * menu, and `chrome.commands`. Main (`src/main/extensions/api/`) does the rest.
 */

// ---------------------------------------------------------------------------------------------
// Match patterns and tab access
// ---------------------------------------------------------------------------------------------

const ALL_URLS_SCHEMES = new Set(["http:", "https:", "ws:", "wss:", "ftp:", "file:"]);

const escapeGlob = (glob: string) => glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");

/** Whether `url` matches a Chrome match pattern (`<all_urls>`, `*://*.example.com/*`, `https://a.b/path*`). */
export function matchesPattern(pattern: string, url: string): boolean {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  if (pattern === "<all_urls>") return ALL_URLS_SCHEMES.has(target.protocol);
  const match = /^(\*|https?|wss?|ftp|file):\/\/([^/]*)(\/.*)$/.exec(pattern);
  if (!match) return false;
  const [, scheme, hostPart, path] = match;
  const protocol = target.protocol.slice(0, -1);
  if (scheme === "*" ? !["http", "https", "ws", "wss"].includes(protocol) : scheme !== protocol) return false;
  if (scheme !== "file") {
    const [host, port] = hostPart.toLowerCase().split(":");
    if (port && port !== "*" && port !== (target.port || (protocol === "https" || protocol === "wss" ? "443" : "80"))) return false;
    const actual = target.hostname.toLowerCase();
    if (host !== "*") {
      if (host.startsWith("*.")) {
        const base = host.slice(2);
        if (actual !== base && !actual.endsWith(`.${base}`)) return false;
      } else if (host !== actual) return false;
    }
  }
  return new RegExp(`^${escapeGlob(path)}$`).test(target.pathname + target.search);
}

/** What an extension was granted that lets it read a tab's address and title. */
export interface TabAccess {
  /** The `tabs` permission. */
  tabs: boolean;
  /** Host permissions (MV3 `host_permissions`, MV2 hosts in `permissions`). */
  hosts: readonly string[];
  /** `activeTab` was granted for this tab (a click on its button or menu item, until it navigates). */
  activeTab: boolean;
}

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

/** What a manifest grants: `tabs`, host patterns, and whether `activeTab` can be granted (per tab, on a click). */
export interface ManifestAccess {
  tabs: boolean;
  hosts: readonly string[];
  activeTab: boolean;
}

export function manifestTabAccess(raw: unknown): ManifestAccess {
  const manifest = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const permissions = strings(manifest.permissions);
  const isPattern = (value: string) => value === "<all_urls>" || value.includes("://");
  return {
    tabs: permissions.includes("tabs"),
    hosts: [...permissions.filter(isPattern), ...strings(manifest.host_permissions).filter(isPattern)],
    activeTab: permissions.includes("activeTab"),
  };
}

/** Whether an extension may read a tab's URL, title and favicon (Chrome's rule). */
export const canReadTab = (access: TabAccess, url: string): boolean =>
  access.tabs || access.activeTab || access.hosts.some((pattern) => matchesPattern(pattern, url));

/** `chrome.tabs.Tab`, as the extension sees it. */
export interface ExtensionTab {
  id: number;
  index: number;
  windowId: number;
  active: boolean;
  highlighted: boolean;
  selected: boolean;
  pinned: boolean;
  incognito: boolean;
  discarded: boolean;
  autoDiscardable: boolean;
  groupId: number;
  status: "loading" | "complete" | "unloaded";
  url?: string;
  pendingUrl?: string;
  title?: string;
  favIconUrl?: string;
}

/** A tab with everything; `redactTab` removes what the extension may not read. */
export type FullTab = ExtensionTab & { url: string; title: string };

/** The tab without its URL, title and favicon when the extension may not read them. */
export function redactTab(tab: FullTab, readable: boolean): ExtensionTab {
  if (readable) return tab;
  const { url: _url, title: _title, favIconUrl: _favicon, pendingUrl: _pending, ...rest } = tab;
  return rest;
}

/** `chrome.tabs.onUpdated`'s changeInfo between two states of a tab (null: nothing changed). */
export function tabChange(before: FullTab, after: FullTab, readable: boolean): Record<string, unknown> | null {
  const change: Record<string, unknown> = {};
  if (before.status !== after.status) change.status = after.status;
  if (before.pinned !== after.pinned) change.pinned = after.pinned;
  if (before.discarded !== after.discarded) change.discarded = after.discarded;
  if (readable) {
    if (before.url !== after.url) change.url = after.url;
    if (before.title !== after.title) change.title = after.title;
    if (before.favIconUrl !== after.favIconUrl && after.favIconUrl) change.favIconUrl = after.favIconUrl;
  }
  return Object.keys(change).length ? change : null;
}

/** `chrome.windows.WINDOW_ID_CURRENT`. */
export const WINDOW_ID_CURRENT = -2;

/** The `chrome.tabs.query` filters understood (others are ignored, as unknown ones are by Chrome). */
export interface TabQuery {
  active?: boolean;
  highlighted?: boolean;
  pinned?: boolean;
  currentWindow?: boolean;
  lastFocusedWindow?: boolean;
  windowId?: number;
  index?: number;
  status?: string;
  discarded?: boolean;
  url?: string | string[];
  title?: string;
}

/** Whether a tab answers a query. `readable`: URL and title filters only match tabs the extension may read. */
export function matchesTabQuery(tab: FullTab, query: TabQuery, windows: { current: number | null; lastFocused: number | null }, readable: boolean): boolean {
  if (query.active !== undefined && tab.active !== query.active) return false;
  if (query.highlighted !== undefined && tab.highlighted !== query.highlighted) return false;
  if (query.pinned !== undefined && tab.pinned !== query.pinned) return false;
  if (query.discarded !== undefined && tab.discarded !== query.discarded) return false;
  if (query.index !== undefined && tab.index !== query.index) return false;
  if (query.status !== undefined && tab.status !== query.status) return false;
  const windowId = query.windowId === WINDOW_ID_CURRENT ? windows.current : query.windowId;
  if (windowId !== undefined && tab.windowId !== windowId) return false;
  if (query.currentWindow !== undefined && (tab.windowId === windows.current) !== query.currentWindow) return false;
  if (query.lastFocusedWindow !== undefined && (tab.windowId === windows.lastFocused) !== query.lastFocusedWindow) return false;
  if (query.url !== undefined) {
    const patterns = typeof query.url === "string" ? [query.url] : query.url;
    if (!readable || !patterns.some((pattern) => matchesPattern(pattern, tab.url))) return false;
  }
  if (query.title !== undefined && (!readable || !new RegExp(`^${escapeGlob(query.title)}$`).test(tab.title))) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// chrome.action
// ---------------------------------------------------------------------------------------------

/** What `chrome.action.set*` changed, for every tab (`global`) or one tab. */
export interface ActionProps {
  badgeText?: string;
  /** CSS color. */
  badgeColor?: string;
  badgeTextColor?: string;
  title?: string;
  /** `data:` image. */
  icon?: string;
  /** Path inside the extension; "" = no popup (clicks reach `action.onClicked`). */
  popup?: string;
  enabled?: boolean;
}

/** One extension's button state: the window UI resolves it for the active tab (by our tab id). */
export interface ActionState {
  global: ActionProps;
  tabs: Record<string, ActionProps>;
}

/** The state of the button for a tab: the tab's own values over the global ones. */
export const resolveAction = (state: ActionState | undefined, tabId: string | null | undefined): ActionProps =>
  state ? { ...state.global, ...(tabId ? state.tabs[tabId] : undefined) } : {};

export const MAX_BADGE_LENGTH = 8;

const hex2 = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");

/** A badge color (`"#4688F1"`, `"red"`, `[r, g, b, a]`) as a CSS color, or null when invalid. */
export function badgeColor(value: unknown): string | null {
  if (Array.isArray(value) && value.length === 4 && value.every((part) => typeof part === "number" && Number.isFinite(part))) {
    const [r, g, b, a] = value as number[];
    return `#${hex2(r)}${hex2(g)}${hex2(b)}${a >= 255 ? "" : hex2(a)}`;
  }
  if (typeof value !== "string") return null;
  const color = value.trim();
  return /^#[0-9a-f]{3,8}$/i.test(color) || /^[a-z]{3,20}$/i.test(color) || /^rgba?\([\d\s.,%]+\)$/i.test(color) ? color : null;
}

// ---------------------------------------------------------------------------------------------
// chrome.contextMenus
// ---------------------------------------------------------------------------------------------

export const MENU_CONTEXTS = ["all", "page", "frame", "selection", "link", "editable", "image", "video", "audio", "action", "browser_action", "page_action"] as const;
export type MenuContext = (typeof MENU_CONTEXTS)[number];
export type MenuItemType = "normal" | "checkbox" | "radio" | "separator";

export interface MenuItem {
  id: string;
  type: MenuItemType;
  title: string;
  contexts: MenuContext[];
  parentId?: string;
  checked: boolean;
  enabled: boolean;
  visible: boolean;
  documentUrlPatterns?: string[];
  targetUrlPatterns?: string[];
}

/** Items per extension (Chrome: 1000 at most). */
export const MAX_MENU_ITEMS = 1000;
const MAX_TITLE = 300;

const menuId = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= 256 ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : null;

/**
 * A menu item from `contextMenus.create`/`update` properties, applied over `base` (update) or the
 * defaults (create). Returns an error message (English, as Chrome's) when the properties are invalid.
 */
export function menuItemFrom(props: unknown, items: readonly MenuItem[], base?: MenuItem): MenuItem | string {
  if (typeof props !== "object" || props === null) return "Invalid properties";
  const p = props as Record<string, unknown>;
  const id = base?.id ?? menuId(p.id);
  if (!id) return "Missing id";
  if (!base && items.some((item) => item.id === id)) return `Cannot create item with duplicate id ${id}`;
  if (!base && items.length >= MAX_MENU_ITEMS) return "Too many menu items";
  const type = p.type === undefined ? (base?.type ?? "normal") : p.type;
  if (type !== "normal" && type !== "checkbox" && type !== "radio" && type !== "separator") return "Invalid type";
  const title = p.title === undefined ? (base?.title ?? "") : typeof p.title === "string" ? p.title.slice(0, MAX_TITLE) : null;
  if (title === null) return "Invalid title";
  if (type !== "separator" && !title) return "Title is required";
  let contexts = base?.contexts ?? (["page"] as MenuContext[]);
  if (p.contexts !== undefined) {
    const list = Array.isArray(p.contexts) ? p.contexts : [p.contexts];
    if (!list.length || !list.every((context) => (MENU_CONTEXTS as readonly unknown[]).includes(context))) return "Invalid contexts";
    contexts = list as MenuContext[];
  }
  let parentId = base?.parentId;
  if (p.parentId !== undefined) {
    const parent = p.parentId === null ? undefined : (menuId(p.parentId) ?? undefined);
    if (p.parentId !== null && !parent) return "Invalid parentId";
    if (parent && !items.some((item) => item.id === parent)) return `Cannot find menu item with id ${parent}`;
    // No loop: the new parent may not be the item or one of its descendants.
    for (let at = parent; at; at = items.find((item) => item.id === at)?.parentId) if (at === id) return "Cannot set a menu item's parent to itself";
    parentId = parent;
  }
  const patterns = (value: unknown, current?: string[]) =>
    value === undefined ? current : value === null ? undefined : Array.isArray(value) ? strings(value).slice(0, 100) : current;
  const flag = (value: unknown, current: boolean) => (typeof value === "boolean" ? value : current);
  return {
    id,
    type,
    title,
    contexts,
    ...(parentId ? { parentId } : {}),
    checked: flag(p.checked, base?.checked ?? false),
    enabled: flag(p.enabled, base?.enabled ?? true),
    visible: flag(p.visible, base?.visible ?? true),
    ...(patterns(p.documentUrlPatterns, base?.documentUrlPatterns) ? { documentUrlPatterns: patterns(p.documentUrlPatterns, base?.documentUrlPatterns) } : {}),
    ...(patterns(p.targetUrlPatterns, base?.targetUrlPatterns) ? { targetUrlPatterns: patterns(p.targetUrlPatterns, base?.targetUrlPatterns) } : {}),
  };
}

/** An item and all its descendants (what `contextMenus.remove` takes away). */
export function withDescendants(items: readonly MenuItem[], id: string): Set<string> {
  const gone = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const item of items) {
      if (item.parentId && gone.has(item.parentId) && !gone.has(item.id)) {
        gone.add(item.id);
        grew = true;
      }
    }
  }
  return gone;
}

/** What a right click on a page is about (Chromium's `context-menu` parameters, the parts menus read). */
export interface MenuTarget {
  pageUrl: string;
  frameUrl: string;
  linkUrl: string;
  srcUrl: string;
  mediaType: string;
  selectionText: string;
  isEditable: boolean;
}

/** The contexts a right click is in (`page` only when nothing more specific is). */
export function menuContextsOf(target: MenuTarget): Set<MenuContext> {
  const contexts = new Set<MenuContext>(["all"]);
  if (target.selectionText) contexts.add("selection");
  if (target.linkUrl) contexts.add("link");
  if (target.isEditable) contexts.add("editable");
  if (target.mediaType === "image") contexts.add("image");
  if (target.mediaType === "video") contexts.add("video");
  if (target.mediaType === "audio") contexts.add("audio");
  if (target.frameUrl && target.frameUrl !== target.pageUrl) contexts.add("frame");
  if (contexts.size === 1 || (contexts.size === 2 && contexts.has("frame"))) contexts.add("page");
  return contexts;
}

/** A page menu entry built from extension items (`./page-menu-model`'s shape, plus the icon). */
export type ExtensionMenuEntry =
  | { id: string; label: string; enabled?: boolean; checked?: boolean; radio?: boolean; icon?: string; submenu?: ExtensionMenuEntry[] }
  | { separator: true };

/** One extension's items, as the page menu merges them. */
export interface ExtensionMenuGroup {
  extensionId: string;
  name: string;
  icon: string | null;
  items: readonly MenuItem[];
}

/** The id of a page menu entry that runs an extension's item. */
export const extensionMenuEntryId = (extensionId: string, itemId: string) => `ext-menu:${extensionId}:${itemId}`;

export function parseExtensionMenuEntryId(id: string): { extensionId: string; itemId: string } | null {
  const match = /^ext-menu:([a-p]{32}):(.+)$/s.exec(id);
  return match ? { extensionId: match[1], itemId: match[2] } : null;
}

const MAX_SELECTION_IN_TITLE = 32;

/** `%s` in a title stands for the selected text (Chrome). */
export const menuTitle = (title: string, selection: string) =>
  title.replace(/%s/g, selection.length > MAX_SELECTION_IN_TITLE ? `${selection.slice(0, MAX_SELECTION_IN_TITLE - 1)}…` : selection);

function shown(item: MenuItem, contexts: Set<MenuContext>, target: MenuTarget): boolean {
  if (!item.visible) return false;
  if (!item.contexts.some((context) => contexts.has(context))) return false;
  if (item.documentUrlPatterns && !item.documentUrlPatterns.some((pattern) => matchesPattern(pattern, target.pageUrl))) return false;
  if (item.targetUrlPatterns) {
    const targetUrl = target.linkUrl || target.srcUrl;
    if (targetUrl && !item.targetUrlPatterns.some((pattern) => matchesPattern(pattern, targetUrl))) return false;
  }
  return true;
}

/**
 * The extensions' entries of a page menu (ADR-053, as Chrome): an extension with one top-level item
 * shows it directly with the extension's icon; with several, they go under a submenu named after
 * the extension. Children follow their parent (a parent left with no shown child is dropped);
 * radio items are grouped by their neighbours. Empty when no item applies.
 */
export function extensionMenuEntries(groups: readonly ExtensionMenuGroup[], target: MenuTarget): ExtensionMenuEntry[] {
  const contexts = menuContextsOf(target);
  const entries: ExtensionMenuEntry[] = [];
  for (const group of groups) {
    const build = (parentId: string | undefined): ExtensionMenuEntry[] => {
      const out: ExtensionMenuEntry[] = [];
      for (const item of group.items) {
        if (item.parentId !== parentId) continue;
        const children = group.items.some((child) => child.parentId === item.id);
        if (!children && !shown(item, contexts, target)) continue;
        if (children && !item.visible) continue;
        if (item.type === "separator") {
          out.push({ separator: true });
          continue;
        }
        const id = extensionMenuEntryId(group.extensionId, item.id);
        const label = menuTitle(item.title, target.selectionText);
        if (children) {
          const submenu = build(item.id);
          if (submenu.some((entry) => !("separator" in entry))) out.push({ id, label, enabled: item.enabled, submenu });
          continue;
        }
        out.push({
          id,
          label,
          enabled: item.enabled,
          ...(item.type === "checkbox" ? { checked: item.checked } : item.type === "radio" ? { checked: item.checked, radio: true } : {}),
        });
      }
      // No separator first, last or twice in a row.
      return out.filter((entry, index, list) => !("separator" in entry) || (index > 0 && index < list.length - 1 && !("separator" in list[index - 1])));
    };
    const top = build(undefined);
    const real = top.filter((entry) => !("separator" in entry));
    if (!real.length) continue;
    const icon = group.icon ?? undefined;
    if (real.length === 1 && top.length === 1) entries.push({ ...(real[0] as Exclude<ExtensionMenuEntry, { separator: true }>), ...(icon ? { icon } : {}) });
    else entries.push({ id: `ext-group:${group.extensionId}`, label: group.name, ...(icon ? { icon } : {}), submenu: top });
  }
  return entries;
}

/** `contextMenus.onClicked`'s info object for a click on `item`. */
export function menuClickInfo(item: MenuItem, target: MenuTarget, wasChecked: boolean): Record<string, unknown> {
  return {
    menuItemId: /^\d+$/.test(item.id) ? Number(item.id) : item.id,
    ...(item.parentId ? { parentMenuItemId: item.parentId } : {}),
    editable: target.isEditable,
    pageUrl: target.pageUrl,
    ...(target.frameUrl && target.frameUrl !== target.pageUrl ? { frameUrl: target.frameUrl } : {}),
    ...(target.linkUrl ? { linkUrl: target.linkUrl } : {}),
    ...(target.srcUrl ? { srcUrl: target.srcUrl } : {}),
    ...(target.mediaType && target.mediaType !== "none" ? { mediaType: target.mediaType } : {}),
    ...(target.selectionText ? { selectionText: target.selectionText } : {}),
    ...(item.type === "checkbox" || item.type === "radio" ? { checked: item.type === "radio" ? true : !wasChecked, wasChecked } : {}),
  };
}

/** The items after a click on a checkbox (toggled) or radio item (checked, its radio neighbours not). */
export function afterMenuClick(items: readonly MenuItem[], id: string): MenuItem[] {
  const index = items.findIndex((item) => item.id === id);
  const clicked = items[index];
  if (!clicked || (clicked.type !== "checkbox" && clicked.type !== "radio")) return [...items];
  if (clicked.type === "checkbox") return items.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item));
  // A radio group: the adjacent radio items under the same parent.
  const siblings = items.filter((item) => item.parentId === clicked.parentId);
  const at = siblings.indexOf(clicked);
  const group = new Set<string>();
  for (let i = at; i >= 0 && siblings[i].type === "radio"; i--) group.add(siblings[i].id);
  for (let i = at; i < siblings.length && siblings[i].type === "radio"; i++) group.add(siblings[i].id);
  return items.map((item) => (group.has(item.id) ? { ...item, checked: item.id === id } : item));
}

// ---------------------------------------------------------------------------------------------
// chrome.commands
// ---------------------------------------------------------------------------------------------

export interface ExtensionCommand {
  name: string;
  description: string;
  shortcut: string;
}

/** `chrome.commands.getAll()` from the manifest. Shortcuts are not installed (ADR-053): `shortcut` is empty. */
export function manifestCommands(raw: unknown): ExtensionCommand[] {
  const manifest = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const commands = manifest.commands;
  if (typeof commands !== "object" || commands === null || Array.isArray(commands)) return [];
  return Object.entries(commands as Record<string, unknown>).map(([name, value]) => {
    const description = typeof value === "object" && value !== null ? (value as Record<string, unknown>).description : undefined;
    return { name, description: typeof description === "string" ? description : "", shortcut: "" };
  });
}

/** `chrome.permissions.getAll()` from the manifest (granted at install, ADR-049; optional ones never). */
export function manifestPermissions(raw: unknown): { permissions: string[]; origins: string[] } {
  const manifest = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const permissions = strings(manifest.permissions);
  const isPattern = (value: string) => value === "<all_urls>" || value.includes("://");
  return {
    permissions: permissions.filter((value) => !isPattern(value)),
    origins: [...permissions.filter(isPattern), ...strings(manifest.host_permissions)],
  };
}
