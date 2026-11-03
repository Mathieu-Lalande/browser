import { getCommand, type CommandIcon, type CommandId } from "./commands";
import type { ClosedLists } from "./recovery";
import type { TabState } from "./types";

/**
 * Menus built from the command registry (ADR-033), as plain data: the app menu ("…", drawn in
 * the overlay layer), the sidebar's empty-area menu and the space chip menu (native menus, like
 * the tab and page menus). Pure, so unit-tested; each UI turns the nodes into rows and runs them
 * (`command` nodes through the registry, the rest by id).
 */

export type MenuNode =
  /** A registry command: its label (unless overridden), icon and effective shortcut. */
  | { kind: "command"; id: CommandId; label?: string; enabled?: boolean; checked?: boolean }
  /** Something only this menu does (rename a space, open a history entry…). */
  | { kind: "action"; id: string; label: string; icon?: CommandIcon; enabled?: boolean; hint?: string }
  /** A page to open in a new tab (history, favorites, bookmarks). */
  | { kind: "link"; id: string; label: string; url: string; favicon?: string | null }
  | { kind: "submenu"; id: string; label: string; icon: CommandIcon; children: MenuNode[]; enabled?: boolean }
  | { kind: "separator" }
  /** App menu header: sync state and its action. */
  | { kind: "sync" }
  /** App menu zoom row: − % + and full screen. */
  | { kind: "zoom" };

const command = (id: CommandId, extra: Partial<Extract<MenuNode, { kind: "command" }>> = {}): MenuNode => ({ kind: "command", id, ...extra });
const separator: MenuNode = { kind: "separator" };

/** Whether a registry command can run with this active tab (page commands need a web page). */
export function commandEnabled(id: CommandId, activeTab: TabState | null | undefined): boolean {
  if (id === "back") return !!activeTab?.canGoBack;
  if (id === "forward") return !!activeTab?.canGoForward;
  return !getCommand(id).needsPage || isWebPage(activeTab);
}

const isWebPage = (tab: TabState | null | undefined) => !!tab && /^(https?|file):/.test(tab.url) && !tab.interstitial;

/** Applies `commandEnabled` to the command nodes that do not say otherwise, recursively. */
function withAvailability(nodes: MenuNode[], activeTab: TabState | null | undefined): MenuNode[] {
  return nodes.map((node) => {
    if (node.kind === "command" && node.enabled === undefined) return { ...node, enabled: commandEnabled(node.id, activeTab) };
    if (node.kind === "submenu") return { ...node, children: withAvailability(node.children, activeTab) };
    return node;
  });
}

/** The label a node shows. */
export function nodeLabel(node: MenuNode): string {
  if (node.kind === "command") return node.label ?? getCommand(node.id).label;
  if (node.kind === "separator" || node.kind === "sync" || node.kind === "zoom") return "";
  return node.label;
}

/** Every command id of a menu, depth first (tests, and the shortcut hints). */
export function menuCommands(nodes: readonly MenuNode[]): CommandId[] {
  return nodes.flatMap((node) => (node.kind === "command" ? [node.id] : node.kind === "submenu" ? menuCommands(node.children) : []));
}

/** Drops separators at the ends and doubled ones (after hidden entries). */
function tidy(nodes: MenuNode[]): MenuNode[] {
  const out: MenuNode[] = [];
  for (const node of nodes) {
    if (node.kind === "separator" && (!out.length || out.at(-1)!.kind === "separator")) continue;
    out.push(node);
  }
  while (out.at(-1)?.kind === "separator") out.pop();
  return out;
}

// --- App menu ---------------------------------------------------------------------------------

export interface PageLink {
  url: string;
  title: string;
  favicon?: string | null;
}

export interface AppMenuContext {
  activeTab?: TabState | null;
  isPrivate: boolean;
  /** Most recent history entries (10 are shown). */
  history: readonly PageLink[];
  favorites: readonly PageLink[];
  bookmarks: readonly PageLink[];
  recording?: boolean;
  /** Recently closed tabs (of the space shown) and windows (ADR-042). */
  closed?: ClosedLists;
}

/** How many recently closed tabs and windows the Historique submenu lists. */
export const APP_MENU_CLOSED = 8;

/** The ids of "Récemment fermés" entries: `closed-tab-<n>`, `closed-window-<n>` (n: 0 = most recent). */
export function closedEntryOf(id: string): { kind: "tab" | "window"; index: number } | null {
  const match = /^closed-(tab|window)-(\d+)$/.exec(id);
  return match ? { kind: match[1] as "tab" | "window", index: Number(match[2]) } : null;
}

function closedNodes(closed: ClosedLists | undefined): MenuNode[] {
  if (!closed) return [];
  const windows: MenuNode[] = closed.windows.slice(0, APP_MENU_CLOSED).map((entry) => ({
    kind: "action",
    id: `closed-window-${entry.index}`,
    label: `${entry.title} (${entry.tabCount} onglet${(entry.tabCount ?? 0) > 1 ? "s" : ""})`,
    icon: "window",
  }));
  const tabs: MenuNode[] = closed.tabs.slice(0, APP_MENU_CLOSED).map((entry) => ({
    kind: "action",
    id: `closed-tab-${entry.index}`,
    label: entry.title || entry.url || "Onglet",
    icon: "undo",
  }));
  if (!windows.length && !tabs.length) return [];
  return [separator, ...windows, separator, ...tabs];
}

/** How many recent pages the Historique submenu lists, and bookmarks the Favoris one. */
export const APP_MENU_HISTORY = 10;
export const APP_MENU_BOOKMARKS = 15;

const links = (prefix: string, pages: readonly PageLink[], max: number): MenuNode[] =>
  pages.slice(0, max).map((page, index) => ({ kind: "link", id: `${prefix}-${index}`, label: page.title || page.url, url: page.url, favicon: page.favicon ?? null }));

/** The "…" app menu (Zen/Firefox-like), every entry a registry command where one exists. */
export function buildAppMenu(context: AppMenuContext): MenuNode[] {
  const tab = context.activeTab;
  const history: MenuNode[] = [
    ...links("history", context.history, APP_MENU_HISTORY),
    separator,
    command("open-history"),
    command("reopen-closed-tab"),
    command("reopen-closed-window", { enabled: context.closed ? context.closed.windows.length > 0 : undefined }),
    ...closedNodes(context.closed),
  ];
  const bookmarks: MenuNode[] = [
    command("toggle-bookmark", { label: tab?.isBookmarked ? "Retirer cette page des favoris" : "Ajouter cette page aux favoris" }),
    separator,
    ...links("favorite", context.favorites, APP_MENU_BOOKMARKS),
    separator,
    ...links("bookmark", context.bookmarks, APP_MENU_BOOKMARKS),
  ];
  const tools: MenuNode[] = [
    command("screenshot-visible"),
    command("screenshot-full"),
    command("screenshot-element"),
    command("record-video", { label: context.recording ? "Arrêter l'enregistrement" : "Enregistrer une vidéo de l'onglet" }),
    separator,
    command("toggle-reader", { label: tab?.reader ? "Quitter le mode lecture" : "Mode lecture" }),
    command("toggle-mobile-site", { label: tab?.mobileSite ? "Version pour ordinateur" : "Version mobile" }),
    // Boosts are edited from normal windows only (ADR-029).
    ...(context.isPrivate ? [] : [command("open-boosts", { label: "Boost du site" })]),
    command("zap-elements"),
    separator,
    command("view-source"),
    command("devtools"),
  ];
  const help: MenuNode[] = [command("keyboard-shortcuts"), command("about"), command("report-issue")];

  return withAvailability(
    tidy([
      { kind: "sync" },
      separator,
      command("new-tab"),
      command("new-window"),
      command("new-private-window"),
      separator,
      { kind: "submenu", id: "history", label: "Historique", icon: "history", children: tidy(history) },
      { kind: "submenu", id: "bookmarks", label: "Favoris", icon: "star", children: tidy(bookmarks) },
      separator,
      command("open-downloads"),
      command("open-passwords"),
      command("open-extensions", { label: "Extensions et thèmes" }),
      separator,
      command("print"),
      command("save-page"),
      command("translate-page", { label: tab?.translated ? "Afficher l'original" : "Traduire la page" }),
      command("toggle-assistant"),
      command("find"),
      { kind: "zoom" },
      separator,
      command("open-settings"),
      { kind: "submenu", id: "tools", label: "Plus d'outils", icon: "code", children: tidy(tools) },
      { kind: "submenu", id: "help", label: "Aide", icon: "help", children: help },
      separator,
      command("quit"),
    ]),
    tab,
  );
}

// --- Sidebar empty area -----------------------------------------------------------------------

export interface SidebarMenuContext {
  activeTab?: TabState | null;
  isPrivate: boolean;
  compact: boolean;
  sidebarPosition: "left" | "right";
  /** Tabs of the space shown (for "Sélectionner tous les onglets"). */
  tabCount: number;
  canReopen: boolean;
}

/** Right click on the sidebar's empty space. */
export function buildSidebarMenu(context: SidebarMenuContext): MenuNode[] {
  const tab = context.activeTab;
  return withAvailability(
    tidy([
      command("toggle-compact-mode", { checked: context.compact }),
      separator,
      command("new-tab"),
      command("new-folder"),
      separator,
      command("reload", { label: "Actualiser l'onglet sélectionné" }),
      command("toggle-bookmark", { label: tab?.isBookmarked ? "Retirer l'onglet des favoris" : "Ajouter l'onglet aux favoris" }),
      command("select-all-tabs", { enabled: context.tabCount > 0 }),
      command("reopen-closed-tab", { enabled: context.canReopen }),
      separator,
      command("toggle-sidebar-position", { label: context.sidebarPosition === "left" ? "Barre latérale à droite" : "Barre latérale à gauche" }),
      // A private window has a single ephemeral space (ADR-014): nothing to theme.
      ...(context.isPrivate ? [] : [command("edit-space")]),
    ]),
    tab,
  );
}

// --- Space chip --------------------------------------------------------------------------------

export interface SpaceMenuContext {
  index: number;
  count: number;
  canCreate: boolean;
}

/** Ids of the space menu entries that only the chrome UI can carry out (it opens its editor). */
export const SPACE_UI_ACTIONS = ["space-rename", "space-edit"] as const;
export type SpaceUiAction = (typeof SPACE_UI_ACTIONS)[number];

/** Right click on a space chip. */
export function buildSpaceMenu(context: SpaceMenuContext): MenuNode[] {
  return [
    { kind: "action", id: "space-rename", label: "Renommer…", icon: "pencil" },
    { kind: "action", id: "space-edit", label: "Icône et couleur…", icon: "palette" },
    separator,
    { kind: "action", id: "space-move-left", label: "Déplacer à gauche", icon: "back", enabled: context.index > 0 },
    { kind: "action", id: "space-move-right", label: "Déplacer à droite", icon: "forward", enabled: context.index < context.count - 1 },
    separator,
    { kind: "action", id: "space-delete", label: "Supprimer l'espace…", icon: "trash", enabled: context.count > 1 },
    separator,
    command("new-space", { enabled: context.canCreate }),
  ];
}
