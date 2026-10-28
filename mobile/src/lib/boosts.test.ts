import { DEFAULT_FILTERS, newBoost, type Boost } from "@shared/boosts";
import { boostPayload, boostScript, ensureSiteBoost, nextFont, toggleFilter } from "./boosts";

const boost = (overrides: Partial<Boost> = {}): Boost => ({ ...newBoost("b1", "example.com", 1), ...overrides });

/** Runs the injected script against a fake page (the parts of the DOM it touches). */
function runIn(script: string, href: string) {
  const url = new URL(href);
  const elements: Record<string, { id: string; textContent: string; remove: () => void }> = {};
  const document = {
    head: { appendChild: (el: { id: string }) => void (elements[el.id] = el as never) },
    documentElement: {},
    getElementById: (id: string) => elements[id] ?? null,
    createElement: () => {
      const el = { id: "", textContent: "", remove: () => delete elements[el.id] };
      return el;
    },
  };
  const ran: string[] = [];
  const page = { location: { hostname: url.hostname, protocol: url.protocol }, document, console, __ran: ran };
  // The script's eval of user code: recorded instead of run.
  new Function("location", "document", "console", "eval", script)(page.location, page.document, console, (code: string) => ran.push(code));
  return { css: elements["__browser-boosts"]?.textContent ?? null, ran };
}

describe("boosts on the phone", () => {
  const boosts = [
    boost({ id: "a", match: "*.example.com", filters: { ...DEFAULT_FILTERS, sepia: 100 } }),
    boost({ id: "b", match: "news.example.com", zaps: ["#ad"], script: { enabled: true, code: "window.x = 1", allowPrivate: false } }),
    boost({ id: "c", match: "other.org", css: "p{}", enabled: false }),
  ];

  it("sends enabled boosts only, least specific first, scripts only where allowed", () => {
    expect(boostPayload(boosts, false).map((item) => item.match)).toEqual(["*.example.com", "news.example.com"]);
    expect(boostPayload(boosts, false)[1].script).toBe("window.x = 1");
    expect(boostPayload(boosts, true)[1].script).toBe("");
  });

  it("styles matching pages and runs their scripts", () => {
    const result = runIn(boostScript(boostPayload(boosts, false)), "https://news.example.com/a");
    expect(result.css).toContain("sepia(100%)");
    expect(result.css).toContain("#ad { display: none !important; }");
    expect(result.ran).toEqual(["window.x = 1"]);
    expect(runIn(boostScript(boostPayload(boosts, false)), "https://example.com/").ran).toEqual([]);
    expect(runIn(boostScript(boostPayload(boosts, false)), "https://notexample.com/").css).toBeNull();
  });

  it("only restyles on a live update", () => {
    expect(runIn(boostScript(boostPayload(boosts, false), true), "https://news.example.com/").ran).toEqual([]);
  });

  it("toggles quick filters and cycles fonts", () => {
    expect(toggleFilter(boost(), "grayscale", 2).filters.grayscale).toBe(100);
    expect(toggleFilter(toggleFilter(boost(), "invert", 2), "invert", 3).filters.invert).toBe(false);
    expect(nextFont(null)).toBe("system");
    expect(nextFont("rounded")).toBeNull();
  });

  it("creates the site's boost on first use", () => {
    const created = ensureSiteBoost([], "https://www.example.com/", "www.example.com", "n1", 5);
    expect(created.boost).toMatchObject({ id: "n1", match: "*.example.com" });
    expect(ensureSiteBoost(created.boosts, "https://a.example.com/", "a.example.com", "n2", 6).boost.id).toBe("n1");
  });
});
