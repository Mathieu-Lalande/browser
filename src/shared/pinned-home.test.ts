import { describe, expect, it } from "vitest";
import { pinnedHomeLabel, pinnedPlace } from "./pinned-home";

describe("pinned home", () => {
  it("tells home, inside the site and away apart", () => {
    const home = "https://www.notion.so/workspace";
    expect(pinnedPlace(home, "https://www.notion.so/workspace/")).toBe("home");
    expect(pinnedPlace(home, "https://www.notion.so/workspace#top")).toBe("home");
    expect(pinnedPlace(home, "https://notion.so/page-123")).toBe("inside");
    expect(pinnedPlace(home, "https://example.com/")).toBe("away");
    expect(pinnedPlace(null, "https://example.com/")).toBe("home");
    expect(pinnedPlace(home, "")).toBe("home");
    expect(pinnedPlace("not a url", "https://example.com/")).toBe("home");
  });

  it("labels the home by its site", () => {
    expect(pinnedHomeLabel("https://www.notion.so/workspace")).toBe("notion.so");
  });
});
