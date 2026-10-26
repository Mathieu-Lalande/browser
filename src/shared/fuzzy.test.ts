import { describe, expect, it } from "vitest";
import { fold, fuzzyMatch, highlightSegments } from "./fuzzy";

const ranges = (query: string, text: string) => fuzzyMatch(query, text)?.ranges;
const score = (query: string, text: string) => fuzzyMatch(query, text)?.score ?? -Infinity;
/** The matched characters, joined: what the user sees highlighted. */
const highlighted = (query: string, text: string) =>
  highlightSegments(text, fuzzyMatch(query, text)?.ranges ?? [])
    .filter((segment) => segment.match)
    .map((segment) => segment.text);

describe("fold", () => {
  it("ignores case and accents without changing positions", () => {
    expect(fold("Épingler À")).toBe("epingler a");
    expect(fold("Œuvre ß")).toHaveLength("Œuvre ß".length);
    expect(fold("😀a")).toBe("😀a");
  });
});

describe("fuzzyMatch", () => {
  it("requires every character in order", () => {
    expect(fuzzyMatch("ong", "Nouvel onglet")).not.toBeNull();
    expect(fuzzyMatch("gno", "Nouvel onglet")).toBeNull();
    expect(fuzzyMatch("xyz", "Nouvel onglet")).toBeNull();
  });

  it("matches an empty query with no highlight", () => {
    expect(fuzzyMatch("  ", "Anything")).toEqual({ score: 0, ranges: [] });
  });

  it("is case- and accent-insensitive", () => {
    expect(ranges("epingler", "Épingler l'onglet")).toEqual([[0, 8]]);
    expect(ranges("ÉPI", "epingler")).toEqual([[0, 3]]);
  });

  it("highlights contiguous runs and word starts rather than first occurrences", () => {
    // Greedy matching would pick the "o" of "Nouvel"; the best alignment is the word "onglet".
    expect(highlighted("onglet", "Nouvel onglet")).toEqual(["onglet"]);
    expect(highlighted("no", "Nouvel onglet")).toEqual(["No"]);
    expect(highlighted("nvo", "Nouvel onglet")).toEqual(["N", "v", "o"]);
    expect(ranges("fo", "Fermer l'onglet")).toEqual([[0, 1], [9, 10]]);
  });

  it("matches each whitespace-separated token anywhere, in any order", () => {
    expect(highlighted("onglet ferm", "Fermer l'onglet")).toEqual(["Ferm", "onglet"]);
    expect(fuzzyMatch("onglet zzz", "Fermer l'onglet")).toBeNull();
  });

  it("ranks prefixes > word starts > contiguous substrings > scattered letters", () => {
    expect(score("rech", "Recharger la page")).toBeGreaterThan(score("rech", "Page à recharger"));
    expect(score("rech", "Page à recharger")).toBeGreaterThan(score("rech", "La bibliothèque Archer"));
    expect(score("dup", "Dupliquer l'onglet")).toBeGreaterThan(score("dup", "Don't use pipes"));
  });

  it("prefers matches on word starts (initials)", () => {
    expect(score("lo", "Fermer l'onglet")).toBeGreaterThan(score("lo", "Fermer allongé"));
    expect(highlighted("do", "Dupliquer l'onglet")).toEqual(["D", "o"]);
  });

  it("rejects letters scattered in the middle of words", () => {
    expect(fuzzyMatch("aeg", "Actualiser la page")).toBeNull();
    expect(fuzzyMatch("alp", "Actualiser la page")).not.toBeNull();
  });

  it("merges overlapping token ranges", () => {
    expect(ranges("git github", "github.com")).toEqual([[0, 6]]);
  });
});

describe("highlightSegments", () => {
  it("splits text into plain and matched parts", () => {
    expect(highlightSegments("Nouvel onglet", [[0, 1], [7, 13]])).toEqual([
      { text: "N", match: true },
      { text: "ouvel ", match: false },
      { text: "onglet", match: true },
    ]);
    expect(highlightSegments("abc", [])).toEqual([{ text: "abc", match: false }]);
  });

  it("ignores ranges beyond the text", () => {
    expect(highlightSegments("ab", [[1, 5], [7, 8]])).toEqual([
      { text: "a", match: false },
      { text: "b", match: true },
    ]);
  });
});
