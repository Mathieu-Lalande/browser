// @vitest-environment happy-dom
// The store page agent (src/shared/webstore-page.ts) runs in pages: tested here, where the DOM types live.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WEBSTORE_AGENT_SOURCE,
  WEBSTORE_DOM_SOURCE,
  parseStorePageAction,
  storeButtonState,
  webStorePageScript,
  type StoreButtonState,
} from "@shared/webstore-page";

const fixture = (name: string) => readFileSync(resolve(import.meta.dirname, "../../../../tests/fixtures/webstore", name), "utf8");

interface Dom {
  findButton(root: ParentNode): HTMLElement | null;
  findBanner(root: ParentNode, keep: Element | null): HTMLElement | null;
}
interface Agent {
  host: HTMLElement;
  shadow: ShadowRoot;
  update(state: StoreButtonState | null): void;
}

// The page code is plain text: evaluated here as main evaluates it in the page's isolated world.
const dom = (): Dom => (0, eval)(WEBSTORE_DOM_SOURCE) as Dom;
const agent = (prefix: string): Agent => ((0, eval)(WEBSTORE_AGENT_SOURCE) as (prefix: string, dom: Dom) => Agent)(prefix, dom());

function load(name: string): void {
  document.documentElement.innerHTML = fixture(name).replace(/^[\s\S]*?<html[^>]*>/i, "").replace(/<\/html>\s*$/i, "");
}

const setUrl = (url: string) => (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);
const ID = "gppongmhjkpfnbhagpmjfkannfbllamg";
const settle = () => new Promise((resolve) => setTimeout(resolve, 120));

afterEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>";
  vi.restoreAllMocks();
});

describe("store page finder", () => {
  it("finds the greyed French button and the « Passez à Chrome » banner", () => {
    load("detail-fr.html");
    const button = dom().findButton(document)!;
    expect(button.tagName).toBe("BUTTON");
    expect(button.textContent?.trim()).toBe("Ajouter à Chrome");
    const banner = dom().findBanner(document, button)!;
    expect(banner.textContent).toContain("Passez à Chrome pour installer des extensions et des thèmes");
    expect(banner.textContent).toContain("Installer Chrome");
    // Only the banner's box: never the page, its title or the button.
    expect(banner.querySelector("h1")).toBeNull();
    expect(banner.contains(button)).toBe(false);
    expect(banner.classList.contains("Sb7Fwe")).toBe(true);
  });

  it("finds an English role=button « Remove from Chrome » and the « Switch to Chrome » banner", () => {
    load("detail-en.html");
    const button = dom().findButton(document)!;
    expect(button.getAttribute("role")).toBe("button");
    const banner = dom().findBanner(document, button)!;
    expect(banner.tagName).toBe("ASIDE");
    expect(banner.textContent).toContain("Install Chrome");
  });

  it("finds nothing on a page without them", () => {
    document.body.innerHTML = "<main><h1>Chrome</h1><button>Chrome</button><p>Passez au salon</p></main>";
    expect(dom().findButton(document)).toBeNull();
    expect(dom().findBanner(document, null)).toBeNull();
  });
});

describe("store page agent", () => {
  it("replaces the store's button, hides the banner and follows re-renders", async () => {
    setUrl(`https://chromewebstore.google.com/detail/wappalyzer/${ID}?hl=fr`);
    load("detail-fr.html");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const page = agent("secret:");
    page.update(storeButtonState(ID, false, null));
    const theirs = dom().findButton(document)!;
    expect(theirs.style.display).toBe("none");
    expect(theirs.nextElementSibling).toBe(page.host);
    expect((document.querySelector(".Sb7Fwe") as HTMLElement).style.display).toBe("none");
    const ours = page.shadow.querySelector("button")!;
    expect(ours.textContent).toBe("Ajouter à Browser");

    // A click the page dispatches itself is not trusted: nothing is reported.
    ours.click();
    expect(debug).not.toHaveBeenCalled();

    // Progress, then installed.
    page.update(storeButtonState(ID, false, { webStoreId: ID, phase: "verify" }));
    expect(ours.disabled).toBe(true);
    expect(ours.textContent).toBe("Vérification…");
    page.update(storeButtonState(ID, true, null));
    expect(ours.textContent).toBe("Supprimer de Browser");

    // The store re-renders its button: ours follows the new one.
    const fresh = theirs.cloneNode(true) as HTMLElement;
    fresh.removeAttribute("style");
    theirs.replaceWith(fresh);
    await settle();
    expect(fresh.style.display).toBe("none");
    expect(fresh.nextElementSibling).toBe(page.host);

    // Another extension's page (in-app navigation): the store's own button comes back.
    setUrl("https://chromewebstore.google.com/detail/other/abcdefghijklmnopabcdefghijklmnop");
    page.update(null);
    expect(fresh.style.display).toBe("");
    expect(page.host.isConnected).toBe(false);
  });

  it("builds a script that installs once and updates", () => {
    const script = webStorePageScript("p:", storeButtonState(ID, false, { webStoreId: ID, phase: "error", message: "Échec" }));
    expect(script).toContain("globalThis.__browserStore");
    expect(script).toContain('"label":"Réessayer"');
    expect(() => new Function(script)).not.toThrow();
  });
});

describe("store button state and messages", () => {
  it("maps installs to labels", () => {
    expect(storeButtonState(ID, false, null)).toEqual({ id: ID, action: "install", label: "Ajouter à Browser", message: null });
    expect(storeButtonState(ID, false, { webStoreId: ID, phase: "download" }).action).toBeNull();
    expect(storeButtonState(ID, false, { webStoreId: ID, phase: "error", message: "Trop gros" })).toMatchObject({ label: "Réessayer", message: "Trop gros" });
    expect(storeButtonState(ID, true, null).action).toBe("remove");
  });

  it("parses only well-formed clicks", () => {
    expect(parseStorePageAction(JSON.stringify(["install", ID]))).toEqual({ action: "install", id: ID });
    expect(parseStorePageAction(JSON.stringify(["remove", ID]))).toEqual({ action: "remove", id: ID });
    expect(parseStorePageAction(JSON.stringify(["uninstall-all", ID]))).toBeNull();
    expect(parseStorePageAction(JSON.stringify(["install", "../x"]))).toBeNull();
    expect(parseStorePageAction("{")).toBeNull();
  });
});
