/**
 * Fuzzy matching for the command palette: every query character must appear in order, and the
 * best alignment is chosen by dynamic programming (fzf-like scoring), so highlights land on
 * word starts and contiguous runs rather than on the first occurrence of each letter.
 */

/** Half-open `[start, end)` range of matched characters in the original text. */
export type Range = [start: number, end: number];

export interface FuzzyMatch {
  /** Higher is better; only meaningful to compare matches of the same query. */
  score: number;
  /** Sorted, non-overlapping, merged ranges to highlight. */
  ranges: Range[];
}

const SCORE_MATCH = 16;
const GAP_START = 3;
const GAP_EXTENSION = 1;
/** Match right after a separator (start of a word, path segment…). */
const BONUS_BOUNDARY = 8;
/** Match on an upper-case letter that follows a lower-case one ("camelCase"). */
const BONUS_CAMEL = 7;
/** Minimum bonus for a match that continues the previous one. */
const BONUS_CONSECUTIVE = 4;
/** The first query character weighs more: "nt" should prefer "Nouvel onglet"'s N. */
const FIRST_CHAR_MULTIPLIER = 2;
/** Longest jump to a character that does not start a word ("nvo" → "NouVel Onglet"). */
const MAX_INNER_GAP = 3;
/** Longer texts are only matched on their beginning (titles and URLs can be huge). */
const MAX_TEXT_LENGTH = 256;

const isWordChar = (char: string) => /[\p{L}\p{N}]/u.test(char);

/**
 * Case- and accent-insensitive form of `text`, one code unit per original code unit so that
 * positions map back to the original string ("É" → "e").
 */
export function fold(text: string): string {
  let result = "";
  for (const unit of text) {
    const folded = unit.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    // Keep the length stable: characters that fold to several units (or none) stay as they are.
    result += folded.length === unit.length ? folded : unit.toLowerCase().length === unit.length ? unit.toLowerCase() : unit;
  }
  return result;
}

function bonuses(text: string): number[] {
  const result = new Array<number>(text.length);
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const previous = i > 0 ? text[i - 1] : "";
    if (!isWordChar(char)) result[i] = 0;
    else if (!previous || !isWordChar(previous)) result[i] = BONUS_BOUNDARY;
    else if (previous !== previous.toUpperCase() && char !== char.toLowerCase()) result[i] = BONUS_CAMEL;
    else result[i] = 0;
  }
  return result;
}

/** Best alignment of one (folded) token in `haystack`, or null if it is not a subsequence. */
function matchToken(token: string, haystack: string, bonus: readonly number[]): { score: number; positions: number[] } | null {
  const n = haystack.length;
  const m = token.length;
  if (m > n) return null;

  // Cheap rejection before the O(n·m) pass.
  for (let i = 0, j = 0; j < m; i++) {
    if (i === n) return null;
    if (haystack[i] === token[j]) j++;
  }

  // rows[j][i]: best score with token[j] matched at haystack[i] (-Infinity if impossible);
  // from[j][i]: where token[j - 1] was matched for that score.
  const rows: Float64Array[] = [];
  const from: Int32Array[] = [];
  for (let j = 0; j < m; j++) {
    const row = new Float64Array(n).fill(-Infinity);
    const back = new Int32Array(n).fill(-1);
    const previous = rows[j - 1];
    // Best `previous[k] - gap penalty` over k ≤ i - 2 (a gap of at least one character).
    let carry = -Infinity;
    let carryFrom = -1;
    for (let i = 0; i < n; i++) {
      if (previous && i >= 2) {
        const candidate = previous[i - 2] - GAP_START;
        carry -= GAP_EXTENSION;
        if (candidate >= carry) {
          carry = candidate;
          carryFrom = i - 2;
        }
      }
      if (haystack[i] !== token[j]) continue;
      if (!previous) {
        row[i] = SCORE_MATCH + bonus[i] * FIRST_CHAR_MULTIPLIER;
        continue;
      }
      let best = -Infinity;
      let source = -1;
      if (i >= 1 && previous[i - 1] > -Infinity) {
        best = previous[i - 1] + SCORE_MATCH + Math.max(bonus[i], BONUS_CONSECUTIVE);
        source = i - 1;
      }
      if (carry > -Infinity && carry + SCORE_MATCH + bonus[i] > best) {
        best = carry + SCORE_MATCH + bonus[i];
        source = carryFrom;
      }
      row[i] = best;
      back[i] = source;
    }
    rows.push(row);
    from.push(back);
  }

  const last = rows[m - 1];
  let end = -1;
  for (let i = 0; i < n; i++) if (last[i] > (end === -1 ? -Infinity : last[end])) end = i;
  if (end === -1) return null;

  const positions = new Array<number>(m);
  for (let j = m - 1, i = end; j >= 0; j--) {
    positions[j] = i;
    i = from[j][i];
  }
  // Letters scattered in the middle of words are noise, not a match: a long jump must land on a
  // word start (initials like "do" → "Dupliquer l'onglet" are fine).
  for (let j = 1; j < m; j++) {
    if (positions[j] - positions[j - 1] - 1 > MAX_INNER_GAP && bonus[positions[j]] === 0) return null;
  }
  return { score: last[end], positions };
}

/** Merges sorted positions into ranges: [1, 2, 3, 7] → [[1, 4], [7, 8]]. */
function toRanges(positions: readonly number[]): Range[] {
  const ranges: Range[] = [];
  for (const position of positions) {
    const previous = ranges.at(-1);
    if (previous && previous[1] >= position) previous[1] = Math.max(previous[1], position + 1);
    else ranges.push([position, position + 1]);
  }
  return ranges;
}

/**
 * Matches `query` against `text`. Whitespace separates tokens that must each match, in any
 * order ("onglet ferm" finds "Fermer l'onglet"). Returns null when a token does not match; an
 * empty query matches everything with a zero score.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { score: 0, ranges: [] };
  const original = text.slice(0, MAX_TEXT_LENGTH);
  const haystack = fold(original);
  const bonus = bonuses(original);
  let score = 0;
  const positions: number[] = [];
  for (const token of tokens) {
    const match = matchToken(token, haystack, bonus);
    if (!match) return null;
    score += match.score;
    positions.push(...match.positions);
  }
  // Whole-text prefix matches ("rech" → "Recharger") beat matches further in.
  if (haystack.startsWith(tokens[0])) score += BONUS_BOUNDARY;
  positions.sort((a, b) => a - b);
  return { score, ranges: toRanges(positions) };
}

/** Splits `text` into plain and highlighted segments, for rendering. */
export function highlightSegments(text: string, ranges: readonly Range[]): { text: string; match: boolean }[] {
  const segments: { text: string; match: boolean }[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start >= text.length) break;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false });
    segments.push({ text: text.slice(Math.max(start, cursor), end), match: true });
    cursor = Math.max(cursor, end);
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}
