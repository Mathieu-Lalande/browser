/**
 * Password checkup (ADR-059): which saved passwords are weak, reused or known from a data breach.
 * Pure: main reads the vault, hashes and asks the breach service; nothing here does I/O.
 *
 * Breaches use the "Pwned Passwords" range API with k-anonymity: only the first 5 hex characters
 * of a password's SHA-1 leave the device; the service answers every suffix of that prefix (padded)
 * and the match is made locally. No password and no full hash ever crosses IPC or the network.
 */

export const BREACH_RANGE_URL = "https://api.pwnedpasswords.com/range/";
/** Concurrent range requests (one per distinct prefix). */
export const BREACH_CONCURRENCY = 4;
export const BREACH_TIMEOUT_MS = 8000;

export type BreachCheck = "ok" | "failed" | "skipped";

/** One entry's findings. Only entries with at least one problem are listed. */
export interface PasswordIssue {
  id: string;
  /** Times seen in breaches (0 when not found, null when not checked). */
  breached: number | null;
  /** Other saved entries with the same password. */
  reused: number;
  weak: boolean;
}

export interface CheckupReport {
  checkedAt: number;
  total: number;
  issues: PasswordIssue[];
  breachCheck: BreachCheck;
}

export interface CheckupCounts {
  breached: number;
  reused: number;
  weak: number;
}

export function checkupCounts(report: CheckupReport): CheckupCounts {
  return {
    breached: report.issues.filter((issue) => (issue.breached ?? 0) > 0).length,
    reused: report.issues.filter((issue) => issue.reused > 0).length,
    weak: report.issues.filter((issue) => issue.weak).length,
  };
}

/** The 0–100 score of the summary ring: every problem entry counts, a breach counts double. */
export function checkupScore(report: CheckupReport): number {
  if (!report.total) return 100;
  const penalty = report.issues.reduce((sum, issue) => sum + ((issue.breached ?? 0) > 0 ? 2 : 1), 0);
  return Math.max(0, Math.round(100 - (penalty / report.total) * 100));
}

// prettier-ignore
const COMMON = new Set([ // i18n-ignore
  "password", "motdepasse", "azerty", "azertyuiop", "qwerty", "qwertyuiop", "123456", "1234567", "12345678", "123456789",
  "1234567890", "111111", "000000", "abc123", "iloveyou", "admin", "welcome", "letmein", "soleil", "doudou", "chouchou",
  "loulou", "marseille", "football", "dragon", "monkey", "sunshine", "princess", "bonjour", "coucou",
]);

const SEQUENCES = ["0123456789", "abcdefghijklmnopqrstuvwxyz", "azertyuiop", "qwertyuiop", "qsdfghjklm", "asdfghjkl"];

/** Whether a password is weak: short, common, a run of one character, a keyboard/number sequence, or too simple for its length. */
export function isWeakPassword(password: string): boolean {
  if (password.length < 8) return true;
  const lower = password.toLowerCase();
  const core = lower.replace(/[\d!?.@#$%&*_-]+$/u, "");
  if (COMMON.has(lower) || COMMON.has(core)) return true;
  if (new Set(password).size <= 2) return true;
  if (SEQUENCES.some((run) => run.includes(lower) || [...run].reverse().join("").includes(lower))) return true;
  const classes = [/[a-z]/u, /[A-Z]/u, /\d/u, /[^A-Za-z\d]/u].filter((pattern) => pattern.test(password)).length;
  return classes === 1 && password.length < 12;
}

/** id → how many other entries share its password. */
export function reuseCounts(entries: readonly { id: string; password: string }[]): Map<string, number> {
  const byPassword = new Map<string, number>();
  for (const entry of entries) if (entry.password) byPassword.set(entry.password, (byPassword.get(entry.password) ?? 0) + 1);
  return new Map(entries.map((entry) => [entry.id, entry.password ? (byPassword.get(entry.password) ?? 1) - 1 : 0]));
}

/** Splits an upper-case SHA-1 hex digest into the range prefix sent and the suffix kept. */
export function rangeParts(sha1: string): { prefix: string; suffix: string } {
  const hex = sha1.toUpperCase();
  return { prefix: hex.slice(0, 5), suffix: hex.slice(5) };
}

/** Parses a range response ("SUFFIX:COUNT" lines, padding lines have a count of 0) into suffix → count. */
export function parseRange(body: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of body.split(/\r?\n/u)) {
    const match = /^([0-9A-Fa-f]{35}):(\d+)$/u.exec(line.trim());
    if (match && Number(match[2]) > 0) counts.set(match[1].toUpperCase(), Number(match[2]));
  }
  return counts;
}

/** Builds the report from the local findings and the breach counts by entry (null when not checked). */
export function buildReport(
  entries: readonly { id: string; password: string }[],
  breaches: ReadonlyMap<string, number> | null,
  breachCheck: BreachCheck,
  now: number,
): CheckupReport {
  const reuse = reuseCounts(entries);
  const issues: PasswordIssue[] = [];
  for (const entry of entries) {
    const issue: PasswordIssue = {
      id: entry.id,
      breached: breaches ? (breaches.get(entry.id) ?? 0) : null,
      reused: reuse.get(entry.id) ?? 0,
      weak: entry.password ? isWeakPassword(entry.password) : false,
    };
    if ((issue.breached ?? 0) > 0 || issue.reused > 0 || issue.weak) issues.push(issue);
  }
  // Worst first: breached, then reused, then weak.
  const rank = (issue: PasswordIssue) => ((issue.breached ?? 0) > 0 ? 0 : issue.reused > 0 ? 1 : 2);
  issues.sort((a, b) => rank(a) - rank(b));
  return { checkedAt: now, total: entries.length, issues, breachCheck };
}

export function isCheckupReport(value: unknown): value is CheckupReport {
  const report = value as CheckupReport;
  return !!report && typeof report.checkedAt === "number" && typeof report.total === "number" && Array.isArray(report.issues);
}
