import { CLEAR_SITE_DATA_SCRIPT, connectionLabel, mobileSiteInfo } from "./siteInfo";

describe("site info sheet (ADR-021)", () => {
  it("describes web pages only", () => {
    expect(mobileSiteInfo("https://www.example.com/a")).toEqual({ host: "www.example.com", secure: true });
    expect(mobileSiteInfo("http://192.168.1.1/")).toEqual({ host: "192.168.1.1", secure: false });
    expect(mobileSiteInfo("")).toBeNull();
    expect(mobileSiteInfo("data:text/html,x")).toBeNull();
    expect(connectionLabel({ host: "a.com", secure: false })).toBe("Connexion non sécurisée (HTTP)");
  });

  it("clears the page's own data with a valid script that ends with true", () => {
    expect(() => new Function(CLEAR_SITE_DATA_SCRIPT)).not.toThrow();
    expect(CLEAR_SITE_DATA_SCRIPT.trim().endsWith("true;")).toBe(true);
    expect(CLEAR_SITE_DATA_SCRIPT).toContain("localStorage.clear()");
  });
});
