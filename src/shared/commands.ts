import type { TabState } from "./types";

/**
 * Registry of browser commands: one source of truth for their label, search keywords and
 * shortcut. Main builds menu items from it and runs commands (`src/main/commands.ts`); the
 * command palette lists them and asks main to run them by id.
 */

export type CommandId =
  | "new-tab"
  | "new-window"
  | "close-tab"
  | "duplicate-tab"
  | "toggle-pin"
  | "reload"
  | "back"
  | "forward"
  | "copy-url"
  | "toggle-bookmark"
  | "focus-address"
  | "toggle-sidebar"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "devtools"
  | "clear-history"
  | "command-palette"
  | "open-settings"
  | "toggle-zen"
  | "find"
  | "find-next"
  | "find-previous"
  | "open-downloads"
  | "toggle-mute"
  | "picture-in-picture"
  | "toggle-split"
  | "new-space"
  | "next-space"
  | "previous-space";

/** Icon names used by commands; the UI's Icon component must know each of them. */
export type CommandIcon =
  | "plus"
  | "window"
  | "close"
  | "duplicate"
  | "pin"
  | "reload"
  | "back"
  | "forward"
  | "copy"
  | "star"
  | "search"
  | "sidebar"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "code"
  | "trash"
  | "command"
  | "settings"
  | "zen"
  | "download"
  | "volume"
  | "pip"
  | "split"
  | "layers";

/** What a command's label and availability may depend on. */
export interface CommandContext {
  activeTab?: TabState;
}

export interface CommandDefinition {
  id: CommandId;
  label: string;
  /** Label when the command would undo the active tab's current state (`toggles`). */
  activeLabel?: string;
  /** Which active-tab flag `activeLabel` follows. */
  toggles?: "isPinned" | "isBookmarked" | "isMuted";
  /** Label in the application menu, when it differs (toggles have a neutral one). */
  menuLabel?: string;
  /** Extra search terms (synonyms, English names). */
  keywords: readonly string[];
  /** Electron accelerator, e.g. "CmdOrCtrl+Shift+C". */
  accelerator?: string;
  icon: CommandIcon;
  /** Only makes sense when the active tab shows a web page (not the start page). */
  needsPage?: boolean;
  /** Listed in the command palette (default true). */
  palette?: boolean;
  /** Destructive commands ask for confirmation in the palette first. */
  confirm?: { title: string; detail: string; action: string };
}

const isMac = (platform: string) => platform === "darwin";

const DEFINITIONS: { [Id in CommandId]: Omit<CommandDefinition, "id"> } = {
  "new-tab": { label: "Nouvel onglet", keywords: ["new tab", "ouvrir"], accelerator: "CmdOrCtrl+T", icon: "plus" },
  "new-window": { label: "Nouvelle fenêtre", keywords: ["new window"], accelerator: "CmdOrCtrl+N", icon: "window" },
  "close-tab": { label: "Fermer l'onglet", keywords: ["close tab"], accelerator: "CmdOrCtrl+W", icon: "close" },
  "duplicate-tab": {
    label: "Dupliquer l'onglet",
    keywords: ["duplicate", "copier l'onglet", "cloner"],
    accelerator: "CmdOrCtrl+Shift+K",
    icon: "duplicate",
  },
  "toggle-pin": {
    label: "Épingler l'onglet",
    activeLabel: "Désépingler l'onglet",
    toggles: "isPinned",
    menuLabel: "Épingler/désépingler l'onglet",
    keywords: ["pin", "unpin"],
    icon: "pin",
  },
  reload: { label: "Actualiser", keywords: ["recharger", "reload", "refresh"], accelerator: "CmdOrCtrl+R", icon: "reload", needsPage: true },
  back: { label: "Page précédente", keywords: ["back", "retour"], icon: "back", needsPage: true },
  forward: { label: "Page suivante", keywords: ["forward", "avancer"], icon: "forward", needsPage: true },
  "copy-url": {
    label: "Copier l'URL",
    keywords: ["copy link", "adresse", "lien"],
    accelerator: "CmdOrCtrl+Shift+C",
    icon: "copy",
    needsPage: true,
  },
  "toggle-bookmark": {
    label: "Ajouter aux favoris",
    activeLabel: "Retirer des favoris",
    toggles: "isBookmarked",
    menuLabel: "Ajouter/retirer des favoris",
    keywords: ["bookmark", "favori", "étoile"],
    accelerator: "CmdOrCtrl+D",
    icon: "star",
    needsPage: true,
  },
  "focus-address": { label: "Barre d'adresse", keywords: ["url", "address", "location"], accelerator: "CmdOrCtrl+L", icon: "search" },
  "toggle-sidebar": {
    label: "Afficher/masquer la barre latérale",
    menuLabel: "Barre latérale",
    keywords: ["sidebar", "panneau", "onglets"],
    accelerator: "CmdOrCtrl+S",
    icon: "sidebar",
  },
  "zoom-in": { label: "Zoom avant", keywords: ["agrandir", "zoom in", "plus grand"], accelerator: "CmdOrCtrl+=", icon: "zoom-in", needsPage: true },
  "zoom-out": { label: "Zoom arrière", keywords: ["réduire", "zoom out", "plus petit"], accelerator: "CmdOrCtrl+-", icon: "zoom-out", needsPage: true },
  "zoom-reset": { label: "Taille réelle", keywords: ["zoom", "réinitialiser", "100 %", "reset"], accelerator: "CmdOrCtrl+0", icon: "zoom-reset", needsPage: true },
  devtools: {
    label: "Outils de développement",
    keywords: ["devtools", "inspecter", "console", "developer"],
    icon: "code",
    needsPage: true,
  },
  "clear-history": {
    label: "Effacer l'historique",
    keywords: ["clear history", "supprimer", "vider", "confidentialité"],
    icon: "trash",
    confirm: {
      title: "Effacer tout l'historique ?",
      detail: "Toutes les pages visitées seront oubliées. Les favoris et les onglets ouverts sont conservés.",
      action: "Effacer l'historique",
    },
  },
  "command-palette": {
    label: "Palette de commandes",
    keywords: ["command", "search", "rechercher"],
    accelerator: "CmdOrCtrl+K",
    icon: "command",
    palette: false,
  },
  "open-settings": {
    label: "Paramètres",
    menuLabel: "Paramètres…",
    keywords: ["settings", "préférences", "options", "thème", "personnaliser"],
    accelerator: "CmdOrCtrl+,",
    icon: "settings",
  },
  "toggle-zen": {
    label: "Mode zen",
    keywords: ["zen", "compact", "focus", "plein écran", "distraction"],
    accelerator: "CmdOrCtrl+Shift+B",
    icon: "zen",
  },
  find: {
    label: "Rechercher dans la page",
    menuLabel: "Rechercher…",
    keywords: ["find", "chercher", "trouver", "occurrences"],
    accelerator: "CmdOrCtrl+F",
    icon: "search",
    needsPage: true,
  },
  // Follow-ups of an open find bar: in the menu (shortcuts), not in the palette.
  "find-next": { label: "Occurrence suivante", keywords: ["find next"], icon: "forward", needsPage: true, palette: false },
  "find-previous": { label: "Occurrence précédente", keywords: ["find previous"], icon: "back", needsPage: true, palette: false },
  "open-downloads": {
    label: "Téléchargements",
    keywords: ["downloads", "fichiers", "télécharger"],
    icon: "download",
  },
  "toggle-mute": {
    label: "Couper le son de l'onglet",
    activeLabel: "Réactiver le son de l'onglet",
    toggles: "isMuted",
    menuLabel: "Couper/réactiver le son de l'onglet",
    keywords: ["mute", "son", "audio", "silence", "muet"],
    // Firefox's shortcut. Ctrl (not Cmd) on macOS too, where Cmd+M minimizes the window.
    accelerator: "Ctrl+M",
    icon: "volume",
    needsPage: true,
  },
  "picture-in-picture": {
    label: "Image dans l'image",
    keywords: ["picture in picture", "pip", "vidéo", "flottante", "lecteur"],
    icon: "pip",
    needsPage: true,
  },
  "toggle-split": {
    label: "Vue scindée",
    keywords: ["split", "scinder", "côte à côte", "diviser", "quitter la vue scindée"],
    accelerator: "CmdOrCtrl+Shift+\\",
    icon: "split",
  },
  "new-space": { label: "Nouvel espace", keywords: ["space", "workspace", "espace de travail", "conteneur"], icon: "layers" },
  "next-space": { label: "Espace suivant", keywords: ["space", "workspace", "next"], accelerator: "CmdOrCtrl+Alt+Right", icon: "forward" },
  "previous-space": {
    label: "Espace précédent",
    keywords: ["space", "workspace", "previous"],
    accelerator: "CmdOrCtrl+Alt+Left",
    icon: "back",
  },
};

/** Every command, in palette order. */
export const COMMANDS: readonly CommandDefinition[] = (Object.keys(DEFINITIONS) as CommandId[]).map((id) => ({
  id,
  ...DEFINITIONS[id],
}));

export function isCommandId(value: unknown): value is CommandId {
  return typeof value === "string" && Object.hasOwn(DEFINITIONS, value);
}

export function getCommand(id: CommandId): CommandDefinition {
  return { id, ...DEFINITIONS[id] };
}

/** Accelerators that follow each platform's convention. */
const PLATFORM_ACCELERATORS: Partial<Record<CommandId, { mac: string; other: string }>> = {
  devtools: { mac: "Alt+Cmd+I", other: "Ctrl+Shift+I" },
  back: { mac: "Cmd+[", other: "Alt+Left" },
  forward: { mac: "Cmd+]", other: "Alt+Right" },
  "find-next": { mac: "Cmd+G", other: "F3" },
  "find-previous": { mac: "Cmd+Shift+G", other: "Shift+F3" },
  // Chrome's shortcuts for the downloads page.
  "open-downloads": { mac: "Alt+Cmd+L", other: "Ctrl+Shift+J" },
};

/** The command's accelerator on `platform` (`process.platform` values). */
export function commandAccelerator(command: CommandDefinition, platform: string): string | undefined {
  const specific = PLATFORM_ACCELERATORS[command.id];
  if (specific) return isMac(platform) ? specific.mac : specific.other;
  return command.accelerator;
}

/** Label for the current state ("Épingler l'onglet" or "Désépingler l'onglet"). */
export function commandLabel(command: CommandDefinition, context: CommandContext): string {
  return command.toggles && command.activeLabel && context.activeTab?.[command.toggles] ? command.activeLabel : command.label;
}

/** Whether the palette should offer the command right now. */
export function isCommandAvailable(command: CommandDefinition, context: CommandContext): boolean {
  if (command.palette === false) return false;
  const tab = context.activeTab;
  if (command.id === "back") return Boolean(tab?.canGoBack);
  if (command.id === "forward") return Boolean(tab?.canGoForward);
  return !command.needsPage || Boolean(tab?.url);
}

const MAC_SYMBOLS: Record<string, string> = { Cmd: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };
const OTHER_NAMES: Record<string, string> = { Cmd: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Maj" };
const KEY_NAMES: Record<string, string> = { "=": "+", Left: "←", Right: "→", Up: "↑", Down: "↓", Plus: "+", Enter: "↵", Escape: "Échap" };
/** Conventional modifier order: ⌃⌥⇧⌘ on macOS, Ctrl+Alt+Maj elsewhere. */
const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Cmd"];

/** Keys to display for an accelerator: "CmdOrCtrl+Shift+C" → ["⇧", "⌘", "C"] or ["Ctrl", "Maj", "C"]. */
export function shortcutKeys(accelerator: string, platform: string): string[] {
  const parts = accelerator.split(/\+(?!$)/);
  const key = parts.pop() ?? "";
  const modifiers = parts.map((part) => {
    if (/^(CmdOrCtrl|CommandOrControl)$/i.test(part)) return isMac(platform) ? "Cmd" : "Ctrl";
    if (/^(Cmd|Command|Meta|Super)$/i.test(part)) return "Cmd";
    if (/^(Ctrl|Control)$/i.test(part)) return "Ctrl";
    if (/^(Alt|Option)$/i.test(part)) return "Alt";
    return "Shift";
  });
  modifiers.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  const names = isMac(platform) ? MAC_SYMBOLS : OTHER_NAMES;
  return [...modifiers.map((modifier) => names[modifier]), KEY_NAMES[key] ?? key.toUpperCase()];
}
