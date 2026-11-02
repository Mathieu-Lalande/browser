import { getContext, setContext } from "svelte";

/**
 * Search filter of a page of `Row`s (settings): a page provides one, every `Row` below it hides
 * itself when it does not match. A section provides a narrower one that also matches its own title.
 */
export interface RowFilter {
  /** True while a search is typed. */
  readonly active: boolean;
  /** Whether a row reading `text` stays visible. */
  matches(text: string): boolean;
}

const KEY = Symbol("row-filter");

/** Lower case, without accents or extra spaces: "Écran" and "ecran" match. */
export const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** A filter matching rows whose text contains every word of `query()`. */
export function queryFilter(query: () => string): RowFilter {
  return {
    get active() {
      return fold(query()) !== "";
    },
    matches(text) {
      const words = fold(query()).split(" ").filter(Boolean);
      const haystack = fold(text);
      return words.every((word) => haystack.includes(word));
    },
  };
}

export const setRowFilter = (filter: RowFilter) => setContext(KEY, filter);
export const getRowFilter = () => getContext<RowFilter | undefined>(KEY);
