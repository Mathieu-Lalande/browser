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
  /** Set (or cleared) by the user on `browser://extensions`, rather than the manifest's suggestion (ADR-057). */
  custom: boolean;
}

/** What `extensionShortcuts` needs of each enabled extension, in install order. */
export interface ShortcutSource {
  id: string;
  name: string;
  manifest: unknown;
  /** The user's choices (ADR-057): command → accelerator, "" for none. Absent commands keep the suggestion. */
  userShortcuts?: UserShortcuts;
}

/** What the user set in the shortcut editor: command → Electron accelerator, "" when cleared. */
export type UserShortcuts = Readonly<Record<string, string>>;

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

/** Why an accelerator cannot be an extension shortcut on `platform` (Chrome's rules), or null. */
export function extensionAcceleratorProblem(accelerator: string, platform: string): "invalid" | "reserved" | null {
  const parsed = parseAccelerator(accelerator);
  if (!parsed || !resolveAccelerator(accelerator, platform)) return "invalid";
  const mods = new Set(parsed.modifiers.map((modifier) => (modifier === "CmdOrCtrl" ? (isMac(platform) ? "Cmd" : "Ctrl") : modifier)));
  // As in Chrome: Ctrl or Alt (Command on macOS) is needed, never Ctrl and Alt together (AltGr).
  if (mods.has("Super") || !(mods.has("Ctrl") || mods.has("Alt") || mods.has("Cmd")) || (mods.has("Ctrl") && mods.has("Alt"))) return "invalid";
  return acceleratorProblem(accelerator, platform) === "reserved" ? "reserved" : null;
}

/** Validates the stored user choices of one extension (ADR-057): unknown shapes and bad accelerators are dropped. */
export function sanitizeUserShortcuts(value: unknown): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [command, accelerator] of Object.entries(record(value)).slice(0, MAX_COMMANDS)) {
    if (!command || command.length > 64 || typeof accelerator !== "string") continue;
    if (accelerator === "") out[command] = "";
    else {
      const normalized = normalizeAccelerator(accelerator);
      if (normalized) out[command] = normalized;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** The user choices after setting `command` to `accelerator` (null: back to the manifest's suggestion, "": none). */
export function withUserShortcut(current: UserShortcuts | undefined, command: string, accelerator: string | null): Record<string, string> | undefined {
  const next: Record<string, string> = { ...current };
  if (accelerator === null) delete next[command];
  else next[command] = accelerator === "" ? "" : (normalizeAccelerator(accelerator) ?? "");
  return sanitizeUserShortcuts(next);
}

/**
 * Every command of the enabled extensions with its shortcut on `platform`: browser shortcuts win,
 * then the keys the user chose (ADR-057), then the suggested ones of the extension installed
 * first; an extension gets four suggested shortcuts at most (the user's own choices do not count).
 */
export function extensionShortcuts(extensions: readonly ShortcutSource[], platform: string, overrides: ShortcutOverrides = {}): ExtensionShortcut[] {
  const taken = new Map<string, string>();
  const entries = extensions.map((extension) => ({ extension, commands: declaredCommands(extension.manifest, platform) }));
  const check = (accelerator: string | null): { resolved: string | null; issue: ShortcutIssue | null } => {
    const resolved = accelerator && resolveAccelerator(accelerator, platform);
    if (!accelerator || !resolved) return { resolved: null, issue: { kind: "invalid" } };
    const problem = extensionAcceleratorProblem(accelerator, platform);
    if (problem) return { resolved, issue: { kind: problem } };
    const label = browserShortcutLabel(accelerator, platform, overrides);
    if (label) return { resolved, issue: { kind: "browser", label } };
    const owner = taken.get(resolved);
    return { resolved, issue: owner !== undefined ? { kind: "extension", name: owner } : null };
  };
  const keyOf = (id: string, command: string) => `${id}\n${command}`;
  // The user's choices first: they claim their keys before any suggestion.
  const chosen = new Map<string, Pick<ExtensionShortcut, "accelerator" | "active" | "issue">>();
  for (const { extension, commands } of entries) {
    for (const command of commands) {
      const user = extension.userShortcuts?.[command.name];
      if (user === undefined || user === "") continue;
      const { resolved, issue } = check(user);
      if (!issue && resolved) taken.set(resolved, extension.name);
      chosen.set(keyOf(extension.id, command.name), { accelerator: user, active: !issue, issue });
    }
  }
  const result: ExtensionShortcut[] = [];
  for (const { extension, commands } of entries) {
    let installed = 0;
    for (const command of commands) {
      const description = command.description || (isExecuteAction(command.name) ? t("extensionShortcuts.activate") : "");
      const base = { extensionId: extension.id, command: command.name, description };
      const own = chosen.get(keyOf(extension.id, command.name));
      if (own) {
        result.push({ ...base, ...own, custom: true });
        continue;
      }
      const cleared = extension.userShortcuts?.[command.name] === "";
      if (cleared || !command.suggested) {
        result.push({ ...base, accelerator: null, active: false, issue: null, custom: cleared });
        continue;
      }
      const accelerator = chromeShortcutToAccelerator(command.suggested, platform);
      const checked = check(accelerator);
      const issue: ShortcutIssue | null = checked.issue ?? (installed >= MAX_SUGGESTED_SHORTCUTS ? { kind: "limit" } : null);
      if (!issue && checked.resolved) {
        taken.set(checked.resolved, extension.name);
        installed++;
      }
      result.push({ ...base, accelerator, active: !issue, issue, custom: false });
    }
  }
  return result;
}

/** What the shortcut editor says about a key the user pressed for an extension command (ADR-057). */
export type ExtensionShortcutCheck = { ok: true; accelerator: string } | { ok: false; issue: ShortcutIssue };

/**
 * Checks `accelerator` for `command` of `extensionId` against the browser's shortcuts and every
 * other extension command installed now (`current`, from `extensionShortcuts`): the editor refuses
 * a key already taken, as Chrome's does. `names`: extension id → name.
 */
export function checkExtensionShortcut(
  extensionId: string,
  command: string,
  accelerator: string,
  platform: string,
  overrides: ShortcutOverrides,
  current: readonly ExtensionShortcut[],
  names: ReadonlyMap<string, string>,
): ExtensionShortcutCheck {
  const normalized = normalizeAccelerator(accelerator);
  if (!normalized) return { ok: false, issue: { kind: "invalid" } };
  const problem = extensionAcceleratorProblem(normalized, platform);
  if (problem) return { ok: false, issue: { kind: problem } };
  const label = browserShortcutLabel(normalized, platform, overrides);
  if (label) return { ok: false, issue: { kind: "browser", label } };
  const resolved = resolveAccelerator(normalized, platform);
  const owner = current.find(
    (shortcut) =>
      shortcut.active &&
      !!shortcut.accelerator &&
      !(shortcut.extensionId === extensionId && shortcut.command === command) &&
      resolveAccelerator(shortcut.accelerator, platform) === resolved,
  );
  if (owner) return { ok: false, issue: { kind: "extension", name: names.get(owner.extensionId) ?? "" } };
  return { ok: true, accelerator: normalized };
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
