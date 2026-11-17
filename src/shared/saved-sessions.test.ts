import { describe, expect, it } from "vitest";
import { addSavedSession, createSavedSession, sanitizeSavedSessions, summarizeSession } from "./saved-sessions";

describe("saved sessions", () => {
  const tabs = [
    { url: "https://www.leboncoin.fr/a", title: "Annonce" },
    { url: "browser://settings", title: "Paramètres" },
    { url: "https://seloger.com/b", title: "Appart" },
  ];

  it("keeps web pages only, with a cleaned name", () => {
    const session = createSavedSession("abcd1", "  Recherche\nappart ", tabs, 5);
    expect(session?.name).toBe("Recherche appart");
    expect(session?.tabs.map((tab) => tab.url)).toEqual(["https://www.leboncoin.fr/a", "https://seloger.com/b"]);
    expect(createSavedSession("abcd2", "", tabs, 5)).toBeNull();
    expect(createSavedSession("abcd3", "Vide", [tabs[1]], 5)).toBeNull();
  });

  it("replaces a session of the same name, newest first, and summarizes sites", () => {
    const a = createSavedSession("aaaa1", "Travail", tabs, 1)!;
    const b = createSavedSession("bbbb1", "Voyage", tabs, 2)!;
    const c = createSavedSession("cccc1", "travail", tabs, 3)!;
    expect(addSavedSession(addSavedSession(addSavedSession([], a), b), c).map((entry) => entry.id)).toEqual(["cccc1", "bbbb1"]);
    expect(summarizeSession(a)).toMatchObject({ count: 2, sites: ["leboncoin.fr", "seloger.com"] });
    expect(sanitizeSavedSessions([a, a, { id: "x" }, null])).toHaveLength(1);
  });
});
