import { DEFAULT_SPACE } from "@shared/spaces";
import { pagerTarget } from "./gestures";
import { mobileTabsToArchive, pagerPages } from "./organize";
import { FOLDER_HEADER, gridLayout, sectionedGrid } from "./overviewLayout";
import { initialTabsModel, overviewGroups, parseSession, PRIVATE_SPACE_ID, serializeSession, SESSION_VERSION, tabsReducer, type TabsAction, type TabsModel } from "./tabs";

/** Organisation on the phone (ADR-022): folders, pager, archive. */

const run = (actions: TabsAction[], model: TabsModel = initialTabsModel()) => actions.reduce(tabsReducer, model);
const open = (id: string, extra: Partial<Extract<TabsAction, { type: "open" }>> = {}): TabsAction => ({ type: "open", id, url: `https://${id}.example/`, now: 1, ...extra });
const space = DEFAULT_SPACE.id;

describe("overview folders", () => {
  it("files tabs, groups cards by folder, renames, folds and deletes", () => {
    let model = run([open("a"), open("b"), open("c"), { type: "add-folder", id: "f1", spaceId: space, name: "  Lecture ", tabId: "b" }]);
    expect(model.folders).toEqual([{ id: "f1", spaceId: space, name: "Lecture", collapsed: false }]);
    model = tabsReducer(model, { type: "set-tab-folder", id: "c", folderId: "f1" });
    let groups = overviewGroups(model);
    expect(groups.loose.map((tab) => tab.id)).toEqual(["a"]);
    expect(groups.folders[0].tabs.map((tab) => tab.id)).toEqual(["b", "c"]);

    model = run([{ type: "rename-folder", id: "f1", name: "Docs" }, { type: "toggle-folder", id: "f1" }], model);
    expect(model.folders[0]).toMatchObject({ name: "Docs", collapsed: true });

    // Deleting keeps the tabs (loose again), or closes them.
    const kept = tabsReducer(model, { type: "remove-folder", id: "f1", now: 2 });
    expect(kept.folders).toEqual([]);
    expect(kept.tabs.map((tab) => tab.folderId)).toEqual([null, null, null]);
    const closed = tabsReducer(model, { type: "remove-folder", id: "f1", closeTabs: true, now: 2 });
    expect(closed.tabs.map((tab) => tab.id)).toEqual(["a"]);
  });

  it("never files private tabs, nor into another space's folder; moving a tab leaves its folder", () => {
    let model = run([
      open("a"),
      open("p", { spaceId: PRIVATE_SPACE_ID }),
      { type: "add-space", id: "work" },
      { type: "add-folder", id: "fw", spaceId: "work", name: "Travail" },
      { type: "add-folder", id: "fp", spaceId: PRIVATE_SPACE_ID, name: "Secret" },
    ]);
    expect(model.folders.map((folder) => folder.id)).toEqual(["fw"]);
    expect(tabsReducer(model, { type: "set-tab-folder", id: "a", folderId: "fw" })).toBe(model);
    expect(tabsReducer(model, { type: "set-tab-folder", id: "p", folderId: "fw" })).toBe(model);
    model = run([{ type: "move-to-space", id: "a", spaceId: "work", now: 2 }, { type: "set-tab-folder", id: "a", folderId: "fw" }], model);
    expect(model.tabs.find((tab) => tab.id === "a")?.folderId).toBe("fw");
    model = run([{ type: "add-space", id: "home" }, { type: "move-to-space", id: "a", spaceId: "home", now: 3 }], model);
    expect(model.tabs.find((tab) => tab.id === "a")?.folderId).toBeNull();
    // A deleted space takes its folders with it.
    expect(tabsReducer(model, { type: "remove-space", id: "work" }).folders).toEqual([]);
  });

  it("persists folders (session v2) and reads v1 sessions without them", () => {
    const model = run([open("a"), { type: "add-folder", id: "f1", spaceId: space, name: "Lecture", tabId: "a" }]);
    expect(SESSION_VERSION).toBe(2);
    const restored = parseSession(JSON.parse(JSON.stringify(serializeSession(model))));
    expect(restored?.folders).toEqual(model.folders);
    expect(restored?.tabs[0].folderId).toBe("f1");
    const v1 = parseSession({ tabs: [{ id: "a", url: "https://a.example/", spaceId: space, folderId: "ghost" }], spaces: [DEFAULT_SPACE], activeSpaceId: space });
    expect(v1?.folders).toEqual([]);
    expect(v1?.tabs[0].folderId).toBeNull();
  });
});

describe("overview layout with folders", () => {
  it("puts each folder header on its own line, its cards below", () => {
    const layout = gridLayout(390, 8);
    const grid = sectionedGrid(layout, [
      { header: false, count: 3 },
      { header: true, count: 1 },
      { header: true, count: 0 },
    ]);
    const line = layout.cardHeight + layout.gap;
    expect(grid.cards).toHaveLength(4);
    expect(grid.cards[2].y).toBe(8 + line);
    expect(grid.headers[0]).toMatchObject({ y: 8 + 2 * line, height: FOLDER_HEADER });
    expect(grid.cards[3].y).toBe(8 + 2 * line + FOLDER_HEADER + layout.gap);
    expect(grid.headers[1].y).toBe(grid.cards[3].y + line);
  });
});

describe("overview pager", () => {
  it("goes to the next/previous space past the threshold or on a fling, never past the ends", () => {
    expect(pagerTarget(1, 3, -150, 0, 390)).toBe(2);
    expect(pagerTarget(1, 3, 150, 0, 390)).toBe(0);
    expect(pagerTarget(1, 3, -40, -900, 390)).toBe(2);
    expect(pagerTarget(1, 3, -40, 0, 390)).toBe(1);
    expect(pagerTarget(0, 3, 200, 0, 390)).toBe(0);
    expect(pagerTarget(2, 3, -200, 0, 390)).toBe(2);
  });

  it("pages follow the chips: private tabs, then each space", () => {
    const model = run([{ type: "add-space", id: "work" }]);
    expect(pagerPages(model, PRIVATE_SPACE_ID)).toEqual([PRIVATE_SPACE_ID, space, "work"]);
  });
});

describe("auto-archiving on the phone", () => {
  const DAY = 24 * 3600_000;
  it("archives idle tabs, never the one on screen, pinned ones, favorites or private tabs", () => {
    const now = 100 * DAY;
    const model = run([
      open("old", { now: now - 10 * DAY }),
      open("pinned", { now: now - 10 * DAY }),
      { type: "pin", id: "pinned", pinned: true },
      open("fav", { now: now - 10 * DAY }),
      open("secret", { now: now - 10 * DAY, spaceId: PRIVATE_SPACE_ID }),
      open("recent", { now: now - DAY }),
      { type: "show-space", spaceId: space },
      open("current", { now }),
    ]);
    const favorites = [{ url: "https://fav.example/", title: "Fav", favicon: null, createdAt: 0 }];
    expect(mobileTabsToArchive(model, favorites, 7 * DAY, now).map((tab) => tab.id)).toEqual(["old"]);
  });
});
