import { describe, expect, it } from "vitest";
import { groupBySite, groupLocally, parseTidyAnswer, tidyPrompt, type TidyTab } from "./tab-tidy";

const tabs: TidyTab[] = [
  { id: "a", title: "Issue 12", url: "https://github.com/x/y/issues/12" },
  { id: "b", title: "PR 3", url: "https://www.github.com/x/y/pull/3?token=secret" },
  { id: "c", title: "Vols Lisbonne", url: "https://kayak.fr/flights" },
  { id: "d", title: "Hôtel Lisbonne", url: "https://booking.com/hotel" },
  { id: "e", title: "Start", url: "" },
];

describe("tab tidy", () => {
  it("groups by site when there is no assistant", () => {
    expect(groupBySite(tabs)).toEqual([{ name: "github.com", tabIds: ["a", "b"] }]);
  });

  it("groups by shared words of titles and site names without the assistant", () => {
    const woodflip: TidyTab[] = [
      { id: "1", title: "WoodFlip – Figurines en bois", url: "https://woodflip.fr/" },
      { id: "2", title: "woodflip - Recherche Google", url: "https://www.google.com/search?q=woodflip" },
      { id: "3", title: "deepl - Recherche Google", url: "https://www.google.com/search?q=deepl" },
      { id: "4", title: "Traduire woodflip", url: "https://www.deepl.com/translator" },
      { id: "5", title: "Météo", url: "https://meteo.fr/" },
    ];
    expect(groupLocally(woodflip)).toEqual([
      { name: "Woodflip", tabIds: ["1", "2", "4"] },
    ]);
  });

  it("never sends full URLs in the prompt", () => {
    const prompt = tidyPrompt(tabs, "fr");
    expect(prompt).toContain("1. Issue 12 — github.com");
    expect(prompt).not.toContain("token=secret");
    expect(prompt).toContain("French");
  });

  it("keeps valid groups only, each tab once", () => {
    const answer = JSON.stringify({
      groups: [
        { name: "  Voyage   Lisbonne ", tabs: [3, 4, 99] },
        { name: "Code", tabs: [1, 2, 3] },
        { name: "Seul", tabs: [5] },
        { name: "", tabs: [1, 2] },
      ],
    });
    expect(parseTidyAnswer(answer, tabs)).toEqual([
      { name: "Voyage Lisbonne", tabIds: ["c", "d"] },
      { name: "Code", tabIds: ["a", "b"] },
    ]);
    expect(parseTidyAnswer("not json", tabs)).toEqual([]);
  });
});
