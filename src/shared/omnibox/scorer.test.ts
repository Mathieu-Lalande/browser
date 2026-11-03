import { describe, expect, it } from "vitest";
import { matchFields, rank, recency, weigh } from "./scorer";
import { parseScope, scopesMatching } from "./scopes";
import type { SectionId, Suggestion } from "./types";

const row = (section: SectionId, key: string, score: number): Suggestion => ({
  key,
  section,
  title: key,
  titleRanges: [],
  detail: "",
  detailRanges: [],
  score,
  icon: "globe",
  verb: "Ouvrir",
  action: { type: "open", url: `https://${key}.test/` },
});

describe("matchFields", () => {
  it("matches each token in the title or the detail, with highlights", () => {
    const match = matchFields("wiki fr", "Wikipédia", "fr.wikipedia.org");
    expect(match?.titleRanges).toEqual([[0, 4]]);
    expect(match?.detailRanges).toEqual([[0, 2]]);
  });

  it("rejects a text when one token matches nowhere, unless a keyword matches it all", () => {
    expect(matchFields("wiki xyz", "Wikipédia", "fr.wikipedia.org")).toBeNull();
    const byKeyword = matchFields("dark", "Thème", "", ["sombre", "dark"]);
    expect(byKeyword?.titleRanges).toEqual([]);
    expect(byKeyword!.score).toBeLessThan(matchFields("dark", "Dark mode")!.score);
  });

  it("prefers title matches over detail matches", () => {
    expect(matchFields("git", "GitHub", "example.org")!.score).toBeGreaterThan(matchFields("git", "Example", "github.com")!.score);
  });

  it("matches everything with a zero score when the text is empty", () => {
    expect(matchFields("", "x")).toEqual({ score: 0, titleRanges: [], detailRanges: [] });
  });
});

describe("weights and boosts", () => {
  it("weighs sections and adds recency", () => {
    expect(weigh("tabs", 10)).toBeGreaterThan(weigh("history", 10));
    expect(weigh("history", 10, 1)).toBeGreaterThan(weigh("history", 10, 0));
    expect(recency(1000, 1000)).toBe(1);
    expect(recency(0, 3 * 24 * 3600 * 1000)).toBeCloseTo(0.5);
  });
});

describe("rank", () => {
  it("orders sections by their best row, pins answers and addresses first and the web search last", () => {
    const sections = rank([row("web", "search", 1), row("history", "h1", 5), row("tabs", "t1", 20), row("history", "h2", 30), row("answer", "a", 1), row("go", "g", 0)]);
    expect(sections.map((section) => section.id)).toEqual(["answer", "go", "history", "tabs", "web"]);
    expect(sections[2].items.map((item) => item.key)).toEqual(["h2", "h1"]);
    expect(sections[2].title).toBe("Historique");
  });

  it("caps each section, more when scoped, and can keep the providers' order", () => {
    const many = Array.from({ length: 50 }, (_, index) => row("commands", `c${index}`, index));
    expect(rank(many)[0].items).toHaveLength(6);
    expect(rank(many, { scoped: true })[0].items).toHaveLength(40);
    expect(rank(many, { keepOrder: true })[0].items[0].key).toBe("c0");
    const sections = rank([row("tabs", "t", 0), row("commands", "c", 9)], { keepOrder: true });
    expect(sections.map((section) => section.id)).toEqual(["tabs", "commands"]);
  });
});

describe("scopes", () => {
  it("splits a complete prefix, long or short, accents optional", () => {
    expect(parseScope("@r zoom")).toEqual({ scope: "settings", text: "zoom", pending: null });
    expect(parseScope("@reglages zoom")).toMatchObject({ scope: "settings", text: "zoom" });
    expect(parseScope("@Onglets ")).toMatchObject({ scope: "tabs", text: "" });
    expect(parseScope("@h git hub")).toMatchObject({ scope: "history", text: "git hub" });
  });

  it("leaves unknown prefixes and plain text alone, and reports a prefix being typed", () => {
    expect(parseScope("@inconnu x")).toEqual({ scope: null, text: "@inconnu x", pending: null });
    expect(parseScope("mail@example.org")).toMatchObject({ scope: null, pending: null });
    expect(parseScope("@hi")).toEqual({ scope: null, text: "@hi", pending: "hi" });
    expect(scopesMatching("hi").map((scope) => scope.id)).toEqual(["history"]);
    expect(scopesMatching("")).toHaveLength(6);
  });
});
