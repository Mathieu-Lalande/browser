/**
 * Extension keyboard shortcuts (ADR-054), pure: the manifest's `commands` (Chrome's syntax),
 * resolved for a platform, checked against the browser's own shortcuts (which always win, ADR-028)
 * and against the shortcuts of extensions installed before. Never global: they only work while a
 * browser window has focus.
 */
import { acceleratorProblem, normalizeAccelerator, parseAccelerator, resolveAccelerator } from "./accelerators";
import { effectiveAliases, findShortcutConflict, fixedShortcuts, getCommand, COMMANDS, type ShortcutOverrides } from "./commands";
import { t } from "./i18n";

/** The commands that press the extension's toolbar button rather than fire `commands.onCommand`. */
export const EXECUTE_ACTION_COMMANDS = ["_execute_action", "_execute_browser_action", "_execute_page_action"] as const;

export const isExecuteAction = (name: string): boolean => (EXECUTE_ACTION_COMMANDS as readonly string[]).includes(name);

/** Chrome installs at most four suggested shortcuts per extension. */
export const MAX_SUGGESTED_SHORTCUTS = 4;
/** Commands read per extension (a manifest is not trusted to stay small). */
const MAX_COMMANDS = 100;

/** Chrome's key names → ours (letters and digits pass through). */
const CHROME_KEYS: Record<string, string> = {
  comma: ",",
  period: ".",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  space: "Space",
  insert: "Insert",
  delete: "Delete",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
};

const isMac = (platform: string) => platform === "darwin";

/**
 * A `suggested_key` in Chrome's syntax ("Ctrl+Shift+Y", "Alt+Shift+P", "Command+Shift+Y",
 * "MacCtrl+Shift+Y") → an Electron accelerator for `platform`, or null when Chrome would refuse it.
 * As in Chrome, "Ctrl" means Command on macOS ("MacCtrl" is the real Control key there), a shortcut
 * needs Ctrl or Alt (Command on macOS), never both Ctrl and Alt (AltGr), and media keys (global in
 * Chrome) are not supported.
 */
export function chromeShortcutToAccelerator(value: unknown, platform: string): string | null {
  if (typeof value !== "string" || !value || value.length > 64) return null;
  const parts = value.split("+").map((part) => part.trim());
  const rawKey = parts.pop() ?? "";
  const key = /^[a-z0-9]$/i.test(rawKey) ? rawKey.toUpperCase() : CHROME_KEYS[rawKey.toLowerCase()];
  if (!key) return null;
  const modifiers = new Set<string>();
  for (const part of parts) {
    const lower = part.toLowerCase();
    let modifier: string | null = null;
    if (lower === "ctrl") modifier = isMac(platform) ? "Cmd" : "Ctrl";
    else if (lower === "command") modifier = isMac(platform) ? "Cmd" : null;
    else if (lower === "macctrl") modifier = isMac(platform) ? "Ctrl" : null;
    else if (lower === "alt") modifier = "Alt";
    else if (lower === "shift") modifier = "Shift";
    if (!modifier || modifiers.has(modifier)) return null;
    modifiers.add(modifier);
  }
  const primary = modifiers.has("Ctrl") || modifiers.has("Alt") || modifiers.has("Cmd");
  if (!primary || (modifiers.has("Ctrl") && modifiers.has("Alt"))) return null;
  return normalizeAccelerator([...modifiers, key].join("+"));
}

const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** The `suggested_key` for `platform`: its own entry, else `default` (a bare string is the default). */
export function suggestedKey(suggested: unknown, platform: string): string | null {
  if (typeof suggested === "string") return suggested;
  const keys = record(suggested);
  const own = isMac(platform) ? keys.mac : platform === "win32" ? keys.windows : platform === "linux" ? keys.linux : undefined;
  const value = typeof own === "string" ? own : keys.default;
  return typeof value === "string" ? value : null;
}

/** One manifest command, as declared. */
export interface DeclaredCommand {
  name: string;
  description: string;
  /** Chrome's syntax, for this platform; null when none is suggested. */
  suggested: string | null;
}

/** The manifest's `commands` (at most `MAX_COMMANDS`), in declaration order. */
export function declaredCommands(manifest: unknown, platform: string): DeclaredCommand[] {
  return Object.entries(record(record(manifest).commands))
    .slice(0, MAX_COMMANDS)
    .filter(([name]) => name.length > 0 && name.length <= 64)
    .map(([name, value]) => {
      const description = record(value).description;
      return { name, description: typeof description === "string" ? description.slice(0, 200) : "", suggested: suggestedKey(record(value).suggested_key, platform) };
    });
}

/** Why a declared shortcut is not installed. */
export type ShortcutIssue =
  /** Not in Chrome's syntax, or a combination Chrome refuses. */
  | { kind: "invalid" }
  /** Kept by the operating system. */
  | { kind: "reserved" }
  /** A browser shortcut (which always wins): `label` names it. */
  | { kind: "browser"; label: string }
  /** An extension installed earlier took it first. */
  | { kind: "extension"; name: string }
  /** Chrome installs four suggested shortcuts per extension at most. */
  | { kind: "limit" };

/** One extension command and its shortcut, as installed (or why not). */
export interface ExtensionShortcut {
  extensionId: string;
  command: string;
  /** The manifest's description (Chrome's default for `_execute_action`). */
  description: string;
  /** The Electron accelerator, when the suggested key is valid on this platform. */
  accelerator: string | null;
  /** Installed: the key fires the command. */
  active: boolean;
  issue: ShortcutIssue | null;
}

/** What `extensionShortcuts` needs of each enabled extension, in install order. */
export interface ShortcutSource {
  id: string;
  name: string;
  manifest: unknown;
}

/** The browser shortcut `accelerator` belongs to (registry, aliases and fixed ones), or null. */
export function browserShortcutLabel(accelerator: string, platform: string, overrides: ShortcutOverrides = {}): string | null {
  const command = findShortcutConflict(accelerator, null, platform, overrides);
  if (command) return getCommand(command).label;
  const resolved = resolveAccelerator(accelerator, platform);
  for (const { id, label } of COMMANDS) {
    if (effectiveAliases(id, platform, overrides).some((alias) => resolveAccelerator(alias, platform) === resolved)) return label;
  }
  return fixedShortcuts(platform).find((shortcut) => resolveAccelerator(shortcut.accelerator, platform) === resolved)?.label ?? null;
}

/**
 * Every command of the enabled extensions with its shortcut on `platform`: browser shortcuts win,
 * then the extension installed first; an extension gets four suggested shortcuts at most.
 */
export function extensionShortcuts(extensions: readonly ShortcutSource[], platform: string, overrides: ShortcutOverrides = {}): ExtensionShortcut[] {
  const taken = new Map<string, string>();
  const result: ExtensionShortcut[] = [];
  for (const extension of extensions) {
    let installed = 0;
    for (const command of declaredCommands(extension.manifest, platform)) {
      const description = command.description || (isExecuteAction(command.name) ? t("extensionShortcuts.activate") : "");
      const base = { extensionId: extension.id, command: command.name, description };
      if (!command.suggested) {
        result.push({ ...base, accelerator: null, active: false, issue: null });
        continue;
      }
      const accelerator = chromeShortcutToAccelerator(command.suggested, platform);
      const resolved = accelerator && resolveAccelerator(accelerator, platform);
      let issue: ShortcutIssue | null = null;
      if (!accelerator || !resolved || !parseAccelerator(accelerator)) issue = { kind: "invalid" };
      else if (acceleratorProblem(accelerator, platform) === "reserved") issue = { kind: "reserved" };
      else {
        const label = browserShortcutLabel(accelerator, platform, overrides);
        const owner = taken.get(resolved);
        if (label) issue = { kind: "browser", label };
        else if (owner !== undefined) issue = { kind: "extension", name: owner };
        else if (installed >= MAX_SUGGESTED_SHORTCUTS) issue = { kind: "limit" };
      }
      if (!issue && resolved) {
        taken.set(resolved, extension.name);
        installed++;
      }
      result.push({ ...base, accelerator, active: !issue, issue });
    }
  }
  return result;
}

const MAC_SYMBOLS: Record<string, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Cmd: "⌘" };

/**
 * The shortcut as `chrome.commands.getAll()` reports it (Chrome's own spelling, not localized):
 * "Ctrl+Shift+Y", "⇧⌘Y" on macOS.
 */
export function chromeShortcutText(accelerator: string, platform: string): string {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return "";
  const key = parsed.key === "," ? "Comma" : parsed.key === "." ? "Period" : parsed.key;
  if (isMac(platform)) {
    const order = ["Ctrl", "Alt", "Shift", "Cmd"];
    const mods = parsed.modifiers.map((modifier) => (modifier === "CmdOrCtrl" || modifier === "Super" ? "Cmd" : modifier));
    return order.filter((modifier) => mods.includes(modifier as never)).map((modifier) => MAC_SYMBOLS[modifier]).join("") + key;
  }
  const mods = parsed.modifiers.map((modifier) => (modifier === "CmdOrCtrl" ? "Ctrl" : modifier === "Super" || modifier === "Cmd" ? "Command" : modifier));
  return [...mods, key].join("+");
}
