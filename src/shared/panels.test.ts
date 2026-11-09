import { describe, expect, it } from "vitest";
import {
  MAX_PANELS,
  PANEL_WIDTH,
  addPanel,
  clampPanelWidth,
  mergePanels,
  movePanel,
  panelBadge,
  panelLabel,
  panelRecord,
  panelToToggle,
  panelUrlFromInput,
  removePanel,
  sanitizePanels,
  sanitizeSyncedPanel,
  updatePanel,
  type WebPanel,
} from "./panels";

const panel = (id: string, url = `https://${id}.example/`): WebPanel => ({ id, url, title: "", mobile: false, width: PANEL_WIDTH.default, favicon: null, createdAt: 1 });

describe("panels model", () => {
  it("adds web pages only, once each, up to the limit", () => {
    const first = addPanel([], { url: "https://web.whatsapp.com/", title: "WhatsApp" }, "a", 5);
    expect(first.ok && first.panel).toMatchObject({ id: "a", title: "WhatsApp", width: PANEL_WIDTH.default, createdAt: 5 });
    if (!first.ok) throw new Error("not added");
    expect(addPanel(first.panels, { url: "https://web.whatsapp.com" }, "b", 6).ok).toBe(false);
    expect(addPanel([], { url: "file:///etc/passwd" }, "c", 6).ok).toBe(false);
    expect(addPanel([], { url: "javascript:alert(1)" }, "c", 6).ok).toBe(false);
    const full = Array.from({ length: MAX_PANELS }, (_, i) => panel(`p${i}`));
    expect(addPanel(full, { url: "https://new.example/" }, "x", 1).ok).toBe(false);
  });

  it("reads typed hosts and URLs", () => {
    expect(panelUrlFromInput("web.whatsapp.com")).toBe("https://web.whatsapp.com/");
    expect(panelUrlFromInput("http://127.0.0.1:8080/app")).toBe("http://127.0.0.1:8080/app");
    expect(panelUrlFromInput("not a url")).toBeNull();
    expect(panelUrlFromInput("chrome://settings")).toBeNull();
  });

  it("moves, removes and patches through the validator", () => {
    const list = [panel("a"), panel("b"), panel("c")];
    expect(movePanel(list, "c", 0).map((p) => p.id)).toEqual(["c", "a", "b"]);
    expect(movePanel(list, "a", 99).map((p) => p.id)).toEqual(["b", "c", "a"]);
    expect(removePanel(list, "b").map((p) => p.id)).toEqual(["a", "c"]);
    expect(updatePanel(list, "a", { width: 5000, mobile: true })[0]).toMatchObject({ width: PANEL_WIDTH.max, mobile: true });
    expect(updatePanel(list, "a", { favicon: "https://evil/x.png" })[0].favicon).toBeNull();
    expect(clampPanelWidth("wide")).toBe(PANEL_WIDTH.default);
  });

  it("sanitizes stored lists", () => {
    expect(sanitizePanels([panel("a"), panel("a"), { id: "B!", url: "https://x/" }, { id: "c", url: "ftp://x/" }, "junk"]).map((p) => p.id)).toEqual(["a"]);
    expect(sanitizePanels(null)).toEqual([]);
  });

  it("reads unread counts from titles", () => {
    expect(panelBadge("(3) WhatsApp")).toBe(3);
    expect(panelBadge("Boîte de réception (12) - moi@example.com - Gmail")).toBe(12);
    expect(panelBadge("(0) Messenger")).toBeNull();
    expect(panelBadge("Spotify")).toBeNull();
    expect(panelBadge("(99999) x")).toBe(999);
  });

  it("toggles the last panel, else the first", () => {
    const list = [panel("a"), panel("b")];
    expect(panelToToggle(list, null, "b")).toEqual({ open: "b" });
    expect(panelToToggle(list, null, "gone")).toEqual({ open: "a" });
    expect(panelToToggle(list, "a", "a")).toEqual({ open: null });
    expect(panelToToggle([], null, null)).toEqual({ open: null });
    expect(panelLabel({ title: "", url: "https://www.example.com/x" })).toBe("example.com");
  });

  it("merges synced panels: positions, local width and favicon kept, one per site", () => {
    const local = [{ ...panel("a"), width: 500, favicon: "data:image/png;base64,AAAA" }, panel("b")];
    const record = sanitizeSyncedPanel({ ...panelRecord({ ...local[0], title: "Renommé" }, 1), favicon: "data:x" }, "a");
    expect(record).toMatchObject({ title: "Renommé", position: 1 });
    expect(record).not.toHaveProperty("favicon");
    expect(sanitizeSyncedPanel({ url: "javascript:1" }, "z")).toBeNull();
    const twin = { id: "c", data: panelRecord(panel("c", "https://b.example/"), 0) };
    const merged = mergePanels(local, [{ id: "a", data: record! }, twin], []);
    expect(merged.map((p) => p.id)).toEqual(["c", "a"]);
    expect(merged[1]).toMatchObject({ title: "Renommé", width: 500, favicon: "data:image/png;base64,AAAA" });
    expect(mergePanels(local, [], ["a"]).map((p) => p.id)).toEqual(["b"]);
  });
});
