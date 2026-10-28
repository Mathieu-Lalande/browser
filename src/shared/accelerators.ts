/**
 * Keyboard accelerators (Electron syntax, e.g. "CmdOrCtrl+Shift+K"), pure: parsing, a canonical
 * spelling, what each one means on a platform (for conflicts), how it is shown, keys that cannot be
 * rebound, and the accelerator of a captured key press (ADR-028).
 */

/**
 * Modifiers as stored. "Cmd" is macOS's Command key, "Super" the Windows/Meta key elsewhere
 * (Electron maps it to Command on macOS), "CmdOrCtrl" is Command on macOS and Ctrl elsewhere.
 */
export type Modifier = "CmdOrCtrl" | "Cmd" | "Super" | "Ctrl" | "Alt" | "Shift";

export interface ParsedAccelerator {
  /** Canonical order (`MODIFIER_ORDER`), without duplicates. */
  modifiers: Modifier[];
  key: string;
}

const MODIFIER_ORDER: Modifier[] = ["CmdOrCtrl", "Cmd", "Super", "Ctrl", "Alt", "Shift"];

const MODIFIER_ALIASES: Record<string, Modifier> = {
  cmdorctrl: "CmdOrCtrl",
  commandorcontrol: "CmdOrCtrl",
  cmd: "Cmd",
  command: "Cmd",
  super: "Super",
  meta: "Super",
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
};

const NAMED_KEYS = [
  "Left",
  "Right",
  "Up",
  "Down",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
  "Delete",
  "Backspace",
  "Tab",
  "Enter",
  "Escape",
  "Space",
  "Plus",
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
];
const KEY_BY_LOWER = new Map(NAMED_KEYS.map((key) => [key.toLowerCase(), key]));
const KEY_ALIASES: Record<string, string> = {
  return: "Enter",
  esc: "Escape",
  del: "Delete",
  arrowleft: "Left",
  arrowright: "Right",
  arrowup: "Up",
  arrowdown: "Down",
  pgup: "PageUp",
  pgdn: "PageDown",
  "+": "Plus",
  " ": "Space",
};
const PUNCTUATION = new Set(["=", "-", ",", ".", "/", "\\", ";", "'", "[", "]", "`"]);

function normalizeKey(raw: string): string | null {
  if (/^[a-z0-9]$/i.test(raw)) return raw.toUpperCase();
  if (PUNCTUATION.has(raw)) return raw;
  const lower = raw.toLowerCase();
  return KEY_BY_LOWER.get(lower) ?? KEY_ALIASES[lower] ?? null;
}

const isFunctionKey = (key: string) => /^F\d{1,2}$/.test(key);

/** "CmdOrCtrl+Shift+k" → { modifiers: ["CmdOrCtrl", "Shift"], key: "K" }; null when malformed. */
export function parseAccelerator(value: unknown): ParsedAccelerator | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return null;
  // A trailing "+" is the Plus key ("Ctrl++"): split on the "+" that are not last.
  const parts = value.trim().split(/\+(?!$)/);
  const rawKey = parts.pop() ?? "";
  const modifiers = new Set<Modifier>();
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.trim().toLowerCase()];
    if (!modifier || modifiers.has(modifier)) return null;
    modifiers.add(modifier);
  }
  const key = normalizeKey(rawKey.trim() || rawKey);
  if (!key) return null;
  return { modifiers: MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key };
}

export function formatAccelerator({ modifiers, key }: ParsedAccelerator): string {
  return [...modifiers, key].join("+");
}

/** Canonical spelling ("shift+cmdorctrl+k" → "CmdOrCtrl+Shift+K"), or null when malformed. */
export function normalizeAccelerator(value: unknown): string | null {
  const parsed = parseAccelerator(value);
  return parsed ? formatAccelerator(parsed) : null;
}

const isMac = (platform: string) => platform === "darwin";

/** Physical modifiers on a platform, in display order. */
type Physical = "Ctrl" | "Alt" | "Shift" | "Meta";
const PHYSICAL_ORDER: Physical[] = ["Ctrl", "Alt", "Shift", "Meta"];

function physicalModifiers(modifiers: readonly Modifier[], platform: string): Physical[] {
  const set = new Set<Physical>();
  for (const modifier of modifiers) {
    if (modifier === "CmdOrCtrl") set.add(isMac(platform) ? "Meta" : "Ctrl");
    else if (modifier === "Cmd" || modifier === "Super") set.add("Meta");
    else set.add(modifier);
  }
  return PHYSICAL_ORDER.filter((modifier) => set.has(modifier));
}

/**
 * What the accelerator means on `platform`, as a comparable string: "CmdOrCtrl+T" and "Ctrl+T" are
 * the same keys on Linux ("Ctrl+T"), not on macOS. "=" and "Plus" stay distinct (Electron does).
 */
export function resolveAccelerator(value: string, platform: string): string | null {
  const parsed = parseAccelerator(value);
  if (!parsed) return null;
  return [...physicalModifiers(parsed.modifiers, platform), parsed.key].join("+");
}

export function sameAccelerator(a: string, b: string, platform: string): boolean {
  const resolved = resolveAccelerator(a, platform);
  return resolved !== null && resolved === resolveAccelerator(b, platform);
}

// --- Display ----------------------------------------------------------------------------------

const MAC_SYMBOLS: Record<Physical, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘" };
const KEY_NAMES: Record<string, string> = {
  "=": "+",
  Plus: "+",
  Left: "←",
  Right: "→",
  Up: "↑",
  Down: "↓",
  Enter: "↵",
  Escape: "Échap",
  Space: "Espace",
  Backspace: "Retour arrière",
  Delete: "Suppr",
  Insert: "Inser",
  PageUp: "Page préc.",
  PageDown: "Page suiv.",
  Home: "Début",
  End: "Fin",
  Tab: "Tab",
};

/** Keys to display: "CmdOrCtrl+Shift+C" → ["⇧", "⌘", "C"] on macOS, ["Ctrl", "Maj", "C"] elsewhere. */
export function acceleratorKeys(value: string, platform: string): string[] {
  const parsed = parseAccelerator(value);
  if (!parsed) return [];
  const names: Record<Physical, string> = isMac(platform)
    ? MAC_SYMBOLS
    : { Ctrl: "Ctrl", Alt: "Alt", Shift: "Maj", Meta: platform === "win32" ? "Win" : "Super" };
  return [...physicalModifiers(parsed.modifiers, platform).map((modifier) => names[modifier]), KEY_NAMES[parsed.key] ?? parsed.key];
}

/** "Ctrl+Maj+B" on Windows/Linux, "⇧⌘B" on macOS. */
export function acceleratorText(value: string, platform: string): string {
  return acceleratorKeys(value, platform).join(isMac(platform) ? "" : "+");
}

// --- Rules ------------------------------------------------------------------------------------

/** Combinations the OS keeps for itself (resolved, per platform family). */
const RESERVED_OTHER = new Set([
  "Ctrl+Alt+Delete",
  "Ctrl+Alt+Backspace",
  "Ctrl+Shift+Escape",
  "Ctrl+Escape",
  "Alt+F4",
  "Alt+Tab",
  "Alt+Shift+Tab",
  "Alt+Escape",
  "Alt+Space",
  "Meta+L",
  "Meta+D",
  "Meta+E",
  "Meta+R",
  "Meta+Tab",
  "Meta+Space",
  ...Array.from({ length: 12 }, (_, i) => `Ctrl+Alt+F${i + 1}`),
]);
const RESERVED_MAC = new Set([
  "Meta+Q",
  "Meta+H",
  "Alt+Meta+H",
  "Meta+M",
  "Meta+Tab",
  "Shift+Meta+Tab",
  "Meta+`",
  "Meta+Space",
  "Ctrl+Space",
  "Alt+Meta+Escape",
  "Ctrl+Meta+Q",
  "Shift+Meta+3",
  "Shift+Meta+4",
  "Shift+Meta+5",
]);

/** Whether the OS keeps `value` for itself on `platform`. */
export function isSystemReserved(value: string, platform: string): boolean {
  const resolved = resolveAccelerator(value, platform);
  if (!resolved) return false;
  return (isMac(platform) ? RESERVED_MAC : RESERVED_OTHER).has(resolved);
}

/**
 * Reserved on some platform. Settings are validated without knowing the platform: "CmdOrCtrl+Q"
 * is Cmd+Q (Quit) on macOS, so it is refused everywhere; a literal "Ctrl+Q" is not.
 */
export function isReservedAnywhere(value: string): boolean {
  return ["darwin", "win32", "linux"].some((platform) => isSystemReserved(value, platform));
}

/** Without Ctrl, Alt or Cmd, a key would stop typing (Shift+A is "A"): only F-keys may go bare. */
export function needsModifier(parsed: ParsedAccelerator): boolean {
  return !isFunctionKey(parsed.key) && !parsed.modifiers.some((modifier) => modifier !== "Shift");
}

export type AcceleratorProblem = "invalid" | "needs-modifier" | "reserved";

/** Why `value` cannot be a shortcut on `platform`, or null when it can. */
export function acceleratorProblem(value: string, platform: string): AcceleratorProblem | null {
  const parsed = parseAccelerator(value);
  if (!parsed) return "invalid";
  if (needsModifier(parsed)) return "needs-modifier";
  return isSystemReserved(value, platform) ? "reserved" : null;
}

// --- Capture ----------------------------------------------------------------------------------

/** A key press, as Electron's `before-input-event` or a DOM `KeyboardEvent` describes it. */
export interface KeyPress {
  key: string;
  code: string;
  control: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

const CODE_KEYS: Record<string, string> = {
  Equal: "=",
  Minus: "-",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backquote: "`",
  Space: "Space",
  NumpadAdd: "Plus",
  NumpadEnter: "Enter",
};

/** The key alone, from the physical key when it is unambiguous (Alt and Shift change `key`). */
function keyOf(press: KeyPress): string | null {
  const code = /^Key([A-Z])$/.exec(press.code)?.[1] ?? /^(?:Digit|Numpad)(\d)$/.exec(press.code)?.[1] ?? CODE_KEYS[press.code];
  if (code) return code;
  if (/^(Control|Alt|AltGraph|Shift|Meta|OS|CapsLock|Dead|Unidentified)$/.test(press.key)) return null;
  return normalizeKey(press.key);
}

/**
 * The accelerator of a captured press, stored literally for this machine: Ctrl stays "Ctrl" (not
 * "CmdOrCtrl"), Command is "Cmd" on macOS and the Windows key "Super" elsewhere. Null while only
 * modifiers are held, or for a key that has no accelerator name.
 */
export function acceleratorFromKeyPress(press: KeyPress, platform: string): string | null {
  const key = keyOf(press);
  if (!key) return null;
  const modifiers: Modifier[] = [];
  if (press.meta) modifiers.push(isMac(platform) ? "Cmd" : "Super");
  if (press.control) modifiers.push("Ctrl");
  if (press.alt) modifiers.push("Alt");
  if (press.shift) modifiers.push("Shift");
  return formatAccelerator({ modifiers: MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier)), key });
}
