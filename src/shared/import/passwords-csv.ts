import { t } from "../i18n";
import { MAX_PASSWORD, MAX_USERNAME, passwordOrigin, type PasswordCapture } from "../passwords";

/**
 * Passwords exported as CSV by another browser or manager (ADR-039). Chromium browsers encrypt
 * their saved passwords with a key held by the OS (DPAPI on Windows, the login keychain on macOS,
 * the Secret Service on Linux) and Firefox with its own key store (`key4.db` + `logins.json`):
 * reading them in place would mean asking the OS for another app's secrets. Every one of them
 * exports a CSV on request instead, which is what this module reads.
 *
 * Formats: Chrome/Edge/Brave/Opera (`name,url,username,password[,note]`), Firefox
 * (`"url","username","password","httpRealm",…`), Safari (`Title,URL,Username,Password,…`),
 * Bitwarden (`…,login_uri,login_username,login_password,…`), and this browser's own export.
 */

/** Largest CSV file read. */
export const MAX_PASSWORD_CSV_BYTES = 8 * 1024 * 1024;

/** RFC 4180 CSV: quoted cells (with `""` escapes and line breaks), CRLF or LF, a leading BOM ignored. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else if (char === "\r") {
        cell += "\n";
        if (source[i + 1] === "\n") i++;
      } else if (char === "\n") cell += "\n";
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}

const COLUMNS = {
  url: ["url", "login_uri", "website", "origin", "web site", "site"],
  username: ["username", "login_username", "login", "user name", "user", "email"],
  password: ["password", "login_password"],
} as const;

/** Undoes the `'` our own export puts before cells a spreadsheet would read as a formula. */
const undefuse = (value: string) => (/^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value);

export interface PasswordCsv {
  entries: PasswordCapture[];
  /** Rows without a web address or a password (Firefox's own accounts, notes…). */
  invalid: number;
  /** French, when the file is not a password export at all. */
  error?: string;
}

/** The logins of a password CSV, one per (origin, username): the last row of a duplicate wins. */
export function parsePasswordCsv(text: string): PasswordCsv {
  const [header, ...rows] = parseCsv(text);
  const names = (header ?? []).map((name) => name.trim().toLowerCase());
  const column = (candidates: readonly string[]) => names.findIndex((name) => candidates.includes(name));
  const url = column(COLUMNS.url);
  const username = column(COLUMNS.username);
  const password = column(COLUMNS.password);
  if (url === -1 || password === -1) return { entries: [], invalid: 0, error: t("importPasswordsCsv.fileIsntPasswordExport") };
  const found = new Map<string, PasswordCapture>();
  let invalid = 0;
  for (const cells of rows) {
    const origin = passwordOrigin(undefuse(cells[url]?.trim() ?? ""));
    const secret = cells[password] ?? "";
    const user = username === -1 ? "" : undefuse(cells[username]?.trim() ?? "");
    if (!origin || !secret || secret.length > MAX_PASSWORD || user.length > MAX_USERNAME) {
      invalid++;
      continue;
    }
    found.set(`${origin}\n${user}`, { origin, username: user, password: secret });
  }
  return { entries: [...found.values()], invalid };
}
