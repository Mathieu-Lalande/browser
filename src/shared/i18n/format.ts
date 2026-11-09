/**
 * ICU-lite message formatting (ADR-052), pure: `{name}` placeholders, and the `plural` and
 * `select` arguments of ICU MessageFormat — `{count, plural, =0 {…} one {# onglet} other {# onglets}}`,
 * `{kind, select, file {…} other {…}}`. `#` inside a plural branch is the formatted number.
 * No apostrophe quoting (French text is full of them): a literal brace is not supported.
 */

export type MessageParams = Readonly<Record<string, string | number | null | undefined>>;
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

/**
 * CLDR plural category of a number, for the app's languages only (Hermes on the phone does not
 * always have `Intl.PluralRules`). French: 0 and 1 (and below 2) are "one"; English: 1 alone.
 */
export function pluralCategory(locale: string, value: number): PluralCategory {
  const n = Math.abs(value);
  if (locale.startsWith("fr")) return n < 2 ? "one" : "other";
  return n === 1 ? "one" : "other";
}

/** Index of the brace closing the one opened at `open`, or -1. */
function closing(pattern: string, open: number): number {
  let depth = 0;
  for (let index = open; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return index;
  }
  return -1;
}

/** `one {…} other {…}` → { one: "…", other: "…" }. */
function parseBranches(body: string): Record<string, string> {
  const branches: Record<string, string> = {};
  let index = 0;
  while (index < body.length) {
    const open = body.indexOf("{", index);
    if (open < 0) break;
    const selector = body.slice(index, open).trim();
    const end = closing(body, open);
    if (end < 0 || !selector) break;
    branches[selector] = body.slice(open + 1, end);
    index = end + 1;
  }
  return branches;
}

function formatNumberValue(locale: string, value: number): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}

/** Splits `{name, type, branches}` into its parts. */
function argumentParts(inner: string): { name: string; type: string | null; body: string } {
  const comma = inner.indexOf(",");
  if (comma < 0) return { name: inner.trim(), type: null, body: "" };
  const rest = inner.slice(comma + 1);
  const second = rest.indexOf(",");
  return { name: inner.slice(0, comma).trim(), type: (second < 0 ? rest : rest.slice(0, second)).trim(), body: second < 0 ? "" : rest.slice(second + 1) };
}

/** Formats `pattern` with `params` (a missing param stays visible as `{name}`). */
export function formatMessage(pattern: string, params: MessageParams = {}, locale = "fr", pound?: string): string {
  let out = "";
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index];
    if (char === "#" && pound !== undefined) {
      out += pound;
      index++;
      continue;
    }
    if (char !== "{") {
      out += char;
      index++;
      continue;
    }
    const end = closing(pattern, index);
    if (end < 0) {
      out += pattern.slice(index);
      break;
    }
    const { name, type, body } = argumentParts(pattern.slice(index + 1, end));
    const value = params[name];
    if (type === null) {
      out += value === undefined || value === null ? `{${name}}` : typeof value === "number" ? formatNumberValue(locale, value) : value;
    } else if (type === "plural") {
      const branches = parseBranches(body);
      const count = Number(value ?? 0);
      const branch = branches[`=${count}`] ?? branches[pluralCategory(locale, count)] ?? branches.other ?? "";
      out += formatMessage(branch, params, locale, formatNumberValue(locale, count));
    } else {
      const branches = parseBranches(body);
      out += formatMessage(branches[String(value)] ?? branches.other ?? "", params, locale, pound);
    }
    index = end + 1;
  }
  return out;
}

/** Placeholder and argument names of a pattern, sorted (the catalog consistency test compares them). */
export function messageArguments(pattern: string): string[] {
  const names = new Set<string>();
  const visit = (text: string) => {
    let index = 0;
    while (index < text.length) {
      const open = text.indexOf("{", index);
      if (open < 0) return;
      const end = closing(text, open);
      if (end < 0) return;
      const { name, type, body } = argumentParts(text.slice(open + 1, end));
      names.add(name);
      if (type !== null) for (const branch of Object.values(parseBranches(body))) visit(branch);
      index = end + 1;
    }
  };
  visit(pattern);
  return [...names].sort();
}
