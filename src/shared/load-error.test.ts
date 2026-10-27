import { describe, expect, it } from "vitest";
import { describeLoadError, loadErrorFamily } from "./load-error";

describe("load errors", () => {
  it("groups Chromium net errors into families", () => {
    expect(loadErrorFamily(-105)).toBe("dns");
    expect(loadErrorFamily(-106)).toBe("offline");
    expect(loadErrorFamily(-102)).toBe("refused");
    expect(loadErrorFamily(-101)).toBe("reset");
    expect(loadErrorFamily(-118)).toBe("timeout");
    expect(loadErrorFamily(-202)).toBe("certificate");
    expect(loadErrorFamily(-310)).toBe("redirects");
    expect(loadErrorFamily(-109)).toBe("unreachable");
    expect(loadErrorFamily(-312)).toBe("blocked");
    expect(loadErrorFamily(-999)).toBe("other");
  });

  it("names the site in French", () => {
    const text = describeLoadError({ code: -105, description: "ERR_NAME_NOT_RESOLVED", url: "https://nope.example/path" });
    expect(text.title).toBe("Site introuvable");
    expect(text.message).toContain("nope.example");
    expect(describeLoadError({ code: -106, description: "", url: "" }).title).toBe("Pas de connexion Internet");
  });
});
