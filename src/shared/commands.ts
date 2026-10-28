import {
  acceleratorKeys,
  acceleratorProblem,
  acceleratorText,
  normalizeAccelerator,
  sameAccelerator,
  type AcceleratorProblem,
} from "./accelerators";
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
  | "previous-space"
  | "new-private-window"
  | "sleep-tab"
  | "sleep-other-tabs"
  | "sync-now"
  | "site-info"
  | "clear-site-data"
  | "toggle-favorite"
  | "new-folder"
  | "open-archive"
  | "open-extensions"
  | "open-passwords"
  | "toggle-reader"
  | "toggle-mobile-site";

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
  | "layers"
  | "mask"
  | "moon"
  | "cloud"
  | "info"
  | "cookie"
  | "favorite"
  | "folder"
  | "archive"
  | "extension"
  | "key"
  | "reader"
  | "smartphone";

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
  toggles?: "isPinned" | "isBookmarked" | "isMuted" | "isFavorite" | "reader" | "mobileSite";
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
  /** Opens a popover in the overlay layer: the palette lets it take its place instead of closing the layer. */
  opensOverlay?: boolean;
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
  "new-private-window": {
    label: "Nouvelle fenêtre privée",
    keywords: ["private", "incognito", "navigation privée", "anonyme"],
    accelerator: "CmdOrCtrl+Shift+N",
    icon: "mask",
  },
  "sleep-tab": {
    label: "Mettre l'onglet en veille",
    keywords: ["sleep", "discard", "veille", "mémoire", "décharger"],
    icon: "moon",
    needsPage: true,
  },
  "sleep-other-tabs": {
    label: "Mettre les autres onglets en veille",
    keywords: ["sleep", "discard", "veille", "mémoire", "libérer"],
    icon: "moon",
  },
  "sync-now": {
    label: "Synchroniser maintenant",
    keywords: ["sync", "synchronisation", "appareils", "téléphone", "devices"],
    icon: "cloud",
  },
  "site-info": {
    label: "Infos sur le site",
    keywords: ["site info", "cadenas", "certificat", "sécurité", "cookies", "autorisations", "permissions"],
    icon: "info",
    needsPage: true,
    opensOverlay: true,
  },
  "clear-site-data": {
    label: "Effacer les données du site",
    keywords: ["cookies", "stockage", "clear site data", "déconnecter", "supprimer"],
    icon: "cookie",
    needsPage: true,
    confirm: {
      title: "Effacer les cookies et données de ce site ?",
      detail: "Vous serez déconnecté de ce site, et la page sera rechargée. Les autres sites ne sont pas touchés.",
      action: "Effacer les données",
    },
  },
  "toggle-favorite": {
    label: "Ajouter aux favoris (tous les espaces)",
    activeLabel: "Retirer des favoris (tous les espaces)",
    toggles: "isFavorite",
    menuLabel: "Ajouter/retirer des favoris (tous les espaces)",
    keywords: ["favorite", "favori", "grille", "tuile", "accès rapide", "arc"],
    icon: "favorite",
    needsPage: true,
  },
  "new-folder": {
    label: "Nouveau dossier",
    keywords: ["folder", "dossier", "groupe", "ranger", "organiser"],
    icon: "folder",
  },
  "open-archive": {
    label: "Onglets archivés",
    keywords: ["archive", "archivés", "anciens onglets", "restaurer", "inactifs"],
    icon: "archive",
  },
  "open-extensions": {
    label: "Extensions",
    keywords: ["extensions", "modules", "add-ons", "plugins", "chrome web store", "crx", "installer une extension"],
    icon: "extension",
  },
  "open-passwords": {
    label: "Mots de passe",
    keywords: ["passwords", "mots de passe", "identifiants", "connexion", "login", "gestionnaire", "remplir"],
    icon: "key",
  },
  "toggle-reader": {
    label: "Mode lecture",
    activeLabel: "Quitter le mode lecture",
    toggles: "reader",
    keywords: ["reader", "lecture", "article", "lire", "readability", "vue simplifiée"],
    accelerator: "CmdOrCtrl+Alt+R",
    icon: "reader",
    needsPage: true,
  },
  "toggle-mobile-site": {
    label: "Demander la version mobile",
    activeLabel: "Demander la version pour ordinateur",
    toggles: "mobileSite",
    menuLabel: "Version mobile du site",
    keywords: ["mobile", "user agent", "téléphone", "responsive", "ordinateur", "desktop site"],
    icon: "smartphone",
    needsPage: true,
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

/** Keys to display for an accelerator: "CmdOrCtrl+Shift+C" → ["⇧", "⌘", "C"] or ["Ctrl", "Maj", "C"]. */
export const shortcutKeys = acceleratorKeys;

/**
 * A shortcut as shown in tooltips and hints, one convention everywhere: "Ctrl+Maj+B" (French
 * "Maj" for Shift) on Windows/Linux, "⇧⌘B" on macOS.
 */
export const shortcutText = acceleratorText;

// --- User shortcuts (ADR-028) -----------------------------------------------------------------

/** Groups of the "Raccourcis clavier" settings: every command exactly once. */
export const COMMAND_GROUPS: readonly { label: string; ids: readonly CommandId[] }[] = [
  {
    label: "Onglets et fenêtres",
    ids: [
      "new-tab",
      "new-window",
      "new-private-window",
      "close-tab",
      "duplicate-tab",
      "toggle-pin",
      "toggle-mute",
      "sleep-tab",
      "sleep-other-tabs",
      "new-folder",
      "toggle-split",
    ],
  },
  { label: "Navigation", ids: ["back", "forward", "reload", "focus-address", "copy-url", "find", "find-next", "find-previous"] },
  {
    label: "Affichage",
    ids: [
      "command-palette",
      "toggle-sidebar",
      "toggle-zen",
      "toggle-reader",
      "toggle-mobile-site",
      "zoom-in",
      "zoom-out",
      "zoom-reset",
      "picture-in-picture",
      "devtools",
    ],
  },
  { label: "Espaces", ids: ["new-space", "next-space", "previous-space"] },
  {
    label: "Bibliothèque et outils",
    ids: [
      "toggle-bookmark",
      "toggle-favorite",
      "open-archive",
      "open-downloads",
      "open-passwords",
      "open-extensions",
      "site-info",
      "clear-site-data",
      "clear-history",
      "sync-now",
      "open-settings",
    ],
  },
];

/** `settings.shortcuts`: per command, an accelerator replacing the default, or null for none. */
export type ShortcutOverrides = Partial<Record<CommandId, string | null>>;

/**
 * The shortcut a command really has: the user's (possibly none), else the registry's. The menu,
 * the palette and every hint read this, never `accelerator` directly.
 */
export function effectiveAccelerator(id: CommandId, platform: string, overrides: ShortcutOverrides = {}): string | undefined {
  if (Object.hasOwn(overrides, id)) return overrides[id] ?? undefined;
  return commandAccelerator(getCommand(id), platform);
}

/** Hidden extra accelerators of a few commands (F5 reloads too), per platform. */
const ALIASES: Partial<Record<CommandId, { mac?: string[]; other?: string[] }>> = {
  reload: { mac: ["F5"], other: ["F5"] },
  // Ctrl+Plus (Shift+= on most layouts) zooms in too.
  "zoom-in": { mac: ["CmdOrCtrl+Plus"], other: ["CmdOrCtrl+Plus"] },
  // Ctrl+G / Ctrl+Shift+G, as in Chrome (macOS already uses Cmd+G as the main shortcut).
  "find-next": { other: ["CmdOrCtrl+G"] },
  "find-previous": { other: ["CmdOrCtrl+Shift+G"] },
};

/**
 * Aliases still active: none once the user chose the command's shortcut, and never one that is
 * another command's shortcut now.
 */
export function effectiveAliases(id: CommandId, platform: string, overrides: ShortcutOverrides = {}): string[] {
  if (Object.hasOwn(overrides, id)) return [];
  const aliases = ALIASES[id]?.[isMac(platform) ? "mac" : "other"] ?? [];
  return aliases.filter((alias) => !findShortcutConflict(alias, id, platform, overrides));
}

/** App shortcuts outside the registry (edition, tab and space numbers): they cannot be taken. */
export function fixedShortcuts(platform: string): { accelerator: string; label: string }[] {
  return [
    { accelerator: "CmdOrCtrl+Z", label: "Annuler" },
    { accelerator: isMac(platform) ? "CmdOrCtrl+Shift+Z" : "CmdOrCtrl+Y", label: "Rétablir" },
    { accelerator: "CmdOrCtrl+X", label: "Couper" },
    { accelerator: "CmdOrCtrl+C", label: "Copier" },
    { accelerator: "CmdOrCtrl+V", label: "Coller" },
    { accelerator: "CmdOrCtrl+A", label: "Tout sélectionner" },
    { accelerator: "Ctrl+Tab", label: "Onglet suivant" },
    { accelerator: "Ctrl+Shift+Tab", label: "Onglet précédent" },
    ...Array.from({ length: 9 }, (_, i) => ({ accelerator: `CmdOrCtrl+${i + 1}`, label: i === 8 ? "Dernier onglet" : `Onglet ${i + 1}` })),
    ...Array.from({ length: 9 }, (_, i) => ({ accelerator: `CmdOrCtrl+Alt+${i + 1}`, label: i === 8 ? "Dernier espace" : `Espace ${i + 1}` })),
  ];
}

/** The command (other than `except`) whose effective shortcut is `accelerator` on `platform`. */
export function findShortcutConflict(
  accelerator: string,
  except: CommandId | null,
  platform: string,
  overrides: ShortcutOverrides = {},
): CommandId | null {
  for (const command of COMMANDS) {
    if (command.id === except) continue;
    const current = effectiveAccelerator(command.id, platform, overrides);
    if (current && sameAccelerator(current, accelerator, platform)) return command.id;
  }
  return null;
}

export type ShortcutCheck =
  | { ok: true; accelerator: string; conflict: CommandId | null }
  | { ok: false; reason: AcceleratorProblem | "fixed"; label?: string };

/**
 * Whether `accelerator` can become `id`'s shortcut: refused when malformed, without modifier,
 * kept by the OS or by a fixed app shortcut; otherwise names the command it would take it from.
 */
export function checkShortcut(id: CommandId, accelerator: string, platform: string, overrides: ShortcutOverrides = {}): ShortcutCheck {
  const normalized = normalizeAccelerator(accelerator);
  if (!normalized) return { ok: false, reason: "invalid" };
  const problem = acceleratorProblem(normalized, platform);
  if (problem) return { ok: false, reason: problem };
  const fixed = fixedShortcuts(platform).find((entry) => sameAccelerator(entry.accelerator, normalized, platform));
  if (fixed) return { ok: false, reason: "fixed", label: fixed.label };
  return { ok: true, accelerator: normalized, conflict: findShortcutConflict(normalized, id, platform, overrides) };
}

/**
 * Overrides once `id` takes `accelerator` (null: no shortcut), the command that had it losing it.
 * A command given back its default shortcut loses its entry.
 */
export function assignShortcut(
  overrides: ShortcutOverrides,
  id: CommandId,
  accelerator: string | null,
  platform: string,
): ShortcutOverrides {
  const next: ShortcutOverrides = { ...overrides };
  if (accelerator) {
    const conflict = findShortcutConflict(accelerator, id, platform, overrides);
    if (conflict) next[conflict] = null;
  }
  const fallback = commandAccelerator(getCommand(id), platform) ?? null;
  const isDefault = accelerator === null ? fallback === null : fallback !== null && sameAccelerator(fallback, accelerator, platform);
  if (isDefault) delete next[id];
  else next[id] = accelerator;
  return next;
}

/** Overrides with `id` back to its default shortcut. */
export function resetShortcut(overrides: ShortcutOverrides, id: CommandId): ShortcutOverrides {
  const next = { ...overrides };
  delete next[id];
  return next;
}

/** The displayed shortcut of a registry command on `platform` ("" when it has none). */
export function commandShortcut(id: CommandId, platform: string, overrides: ShortcutOverrides = {}): string {
  const accelerator = effectiveAccelerator(id, platform, overrides);
  return accelerator ? shortcutText(accelerator, platform) : "";
}

/** A tooltip naming a command's shortcut: "Nouvel onglet (Ctrl+T)", or the label alone. */
export function withShortcut(label: string, id: CommandId, platform: string, overrides: ShortcutOverrides = {}): string {
  const shortcut = commandShortcut(id, platform, overrides);
  return shortcut ? `${label} (${shortcut})` : label;
}
