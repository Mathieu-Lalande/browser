import { describe, expect, it } from "vitest";
import { COOKIE_BANNER_RULES, bannerHandled, cookieBannerAgent, sanitizeBannerResult, type AgentOptions } from ".";
import { fixturePage } from "./fixture-dom";

const OPTIONS: AgentOptions = { watchMs: 5_000, stepMs: 1_000 };

/**
 * One small fixture per CMP, modelled on its real markup: the refusal path closes the banner
 * (`data-closes`), "accept" buttons are present everywhere and must never be clicked.
 */
const FIXTURES: Record<string, { html: string; clicks: string[] }> = {
  onetrust: {
    html: `<div id="onetrust-consent-sdk"><div id="onetrust-banner-sdk"><p>Nous utilisons des cookies</p>
      <button id="onetrust-accept-btn-handler" data-closes="#onetrust-banner-sdk">Tout accepter</button>
      <button id="onetrust-reject-all-handler" data-closes="#onetrust-banner-sdk">Tout refuser</button>
      <button id="onetrust-pc-btn-handler">Paramètres</button></div></div>`,
    clicks: ["Tout refuser"],
  },
  didomi: {
    html: `<div id="didomi-host"><div id="didomi-notice"><button id="didomi-notice-agree-button" data-closes="#didomi-notice">Accepter &amp; Fermer</button>
      <button id="didomi-notice-disagree-button" data-closes="#didomi-notice"><span>Continuer sans accepter</span></button></div></div>`,
    clicks: ["Continuer sans accepter"],
  },
  quantcast: {
    html: `<div id="qc-cmp2-container"><div id="qc-cmp2-ui"><div class="qc-cmp2-summary-buttons">
      <button mode="secondary" data-opens="#qc-options">PLUS D'OPTIONS</button><button mode="primary" data-closes="#qc-cmp2-ui">J'ACCEPTE</button></div>
      <div id="qc-options" hidden><div class="qc-cmp2-header-links"><button mode="link">TOUT REFUSER</button><button mode="link">TOUT ACCEPTER</button></div>
      <div class="qc-cmp2-footer"><button mode="primary" data-closes="#qc-cmp2-ui">ENREGISTRER ET QUITTER</button></div></div></div></div>`,
    clicks: ["PLUS D'OPTIONS", "TOUT REFUSER", "ENREGISTRER ET QUITTER"],
  },
  cookiebot: {
    html: `<div id="CybotCookiebotDialog"><button id="CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll" data-closes="#CybotCookiebotDialog">Autoriser tous les cookies</button>
      <button id="CybotCookiebotDialogBodyButtonDecline" data-closes="#CybotCookiebotDialog">Refuser</button></div>`,
    clicks: ["Refuser"],
  },
  trustarc: {
    html: `<div id="truste-consent-track"><button id="truste-consent-button" data-closes="#truste-consent-track">Accept Cookies</button>
      <button id="truste-consent-required" data-closes="#truste-consent-track">Required Only</button></div>`,
    clicks: ["Required Only"],
  },
  usercentrics: {
    html: `<div id="usercentrics-root"><div data-testid="uc-banner-content"><button data-testid="uc-accept-all-button" data-closes="#usercentrics-root">Accept All</button>
      <button data-testid="uc-deny-all-button" data-closes="[data-testid='uc-banner-content']">Deny</button></div></div>`,
    clicks: ["Deny"],
  },
  axeptio: {
    html: `<div class="axeptio_mount"><div id="axeptio_overlay"><button id="axeptio_btn_acceptAll" data-closes=".axeptio_mount">OK pour moi</button>
      <button id="axeptio_btn_dismiss" data-closes=".axeptio_mount">Non merci</button></div></div>`,
    clicks: ["Non merci"],
  },
  sirdata: {
    html: `<div id="sd-cmp"><div class="sd-cmp-3x1"><button class="sd-cmp-Y5x" data-closes="#sd-cmp">Accepter et fermer</button>
      <button class="sd-cmp-0aQ" data-closes="#sd-cmp"><span>Continuer sans accepter</span></button></div></div>`,
    clicks: ["Continuer sans accepter"],
  },
  cookieyes: {
    html: `<div class="cky-consent-container"><div class="cky-notice-btn-wrapper"><button class="cky-btn cky-btn-customize">Personnaliser</button>
      <button class="cky-btn cky-btn-reject" data-closes=".cky-consent-container">Tout rejeter</button><button class="cky-btn cky-btn-accept" data-closes=".cky-consent-container">Tout accepter</button></div></div>`,
    clicks: ["Tout rejeter"],
  },
  iubenda: {
    html: `<div id="iubenda-cs-banner"><button class="iubenda-cs-accept-btn" data-closes="#iubenda-cs-banner">Accetta</button>
      <button class="iubenda-cs-reject-btn" data-closes="#iubenda-cs-banner">Rifiuta</button></div>`,
    clicks: ["Rifiuta"],
  },
  complianz: {
    html: `<div id="cmplz-cookiebanner-container"><div class="cmplz-cookiebanner"><button class="cmplz-btn cmplz-accept" data-closes=".cmplz-cookiebanner">Accepter</button>
      <button class="cmplz-btn cmplz-deny" data-closes=".cmplz-cookiebanner">Refuser</button></div></div>`,
    clicks: ["Refuser"],
  },
  "funding-choices": {
    html: `<div class="fc-consent-root"><div class="fc-dialog-container"><button class="fc-button fc-cta-consent" data-closes=".fc-dialog-container">Autoriser</button>
      <button class="fc-button fc-cta-do-not-consent" data-closes=".fc-dialog-container">Ne pas autoriser</button></div></div>`,
    clicks: ["Ne pas autoriser"],
  },
  klaro: {
    html: `<div class="klaro"><div class="cookie-notice"><button class="cm-btn cm-btn-success" data-closes=".cookie-notice">Accepter</button>
      <button class="cm-btn cn-decline" data-closes=".cookie-notice">Je refuse</button></div></div>`,
    clicks: ["Je refuse"],
  },
  osano: {
    html: `<div class="osano-cm-window"><div class="osano-cm-dialog"><button class="osano-cm-accept-all" data-closes=".osano-cm-dialog">Accept All</button>
      <button class="osano-cm-denyAll" data-closes=".osano-cm-dialog">Deny</button></div></div>`,
    clicks: ["Deny"],
  },
  termly: {
    html: `<div id="termly-code-snippet-support"><div class="termly-styles-root"><button data-tid="banner-accept" data-closes=".termly-styles-root">Accept</button>
      <button data-tid="banner-decline" data-closes=".termly-styles-root">Decline</button></div></div>`,
    clicks: ["Decline"],
  },
};

describe("cookie banner rules", () => {
  it("cover the common CMPs, each with a fixture", () => {
    expect(COOKIE_BANNER_RULES.map((rule) => rule.id).sort()).toEqual(Object.keys(FIXTURES).sort());
    for (const rule of COOKIE_BANNER_RULES) {
      expect(rule.strategies.length).toBeGreaterThan(0);
      expect(rule.hide.length).toBeGreaterThan(0);
      // Pure data: no rule ever names an "accept" button.
      expect(JSON.stringify(rule)).not.toMatch(/accept|(?<!dis)agree(?!ing)|allow-?all/i);
    }
  });

  for (const [id, fixture] of Object.entries(FIXTURES)) {
    it(`refuses ${id}`, async () => {
      const page = fixturePage(fixture.html);
      expect(await cookieBannerAgent(COOKIE_BANNER_RULES, page.dom, OPTIONS)).toEqual({ cmp: id, outcome: "rejected" });
      expect(page.clicks).toEqual(fixture.clicks);
      expect(page.hidden).toEqual([]);
    });
  }
});

describe("cookie banner agent", () => {
  it("hides the banner when no refusal exists, and never clicks accept", async () => {
    const page = fixturePage(`<div id="CybotCookiebotDialog"><button id="CybotCookiebotDialogBodyButtonDecline">Tout accepter</button></div>`);
    expect(await cookieBannerAgent(COOKIE_BANNER_RULES, page.dom, OPTIONS)).toEqual({ cmp: "cookiebot", outcome: "hidden" });
    expect(page.clicks).toEqual([]);
    expect(page.hidden).toContain("#CybotCookiebotDialog");
  });

  it("hides the banner when the refusal does not close it", async () => {
    const page = fixturePage(`<div id="iubenda-cs-banner"><button class="iubenda-cs-reject-btn">Rifiuta</button></div>`);
    expect(await cookieBannerAgent(COOKIE_BANNER_RULES, page.dom, OPTIONS)).toEqual({ cmp: "iubenda", outcome: "hidden" });
    expect(page.clicks).toEqual(["Rifiuta"]);
  });

  it("waits for a late banner, within its time budget", async () => {
    const page = fixturePage(`<main>Article</main>`);
    page.appendAt(1_500, FIXTURES.complianz.html);
    expect(await cookieBannerAgent(COOKIE_BANNER_RULES, page.dom, OPTIONS)).toEqual({ cmp: "complianz", outcome: "rejected" });

    const tooLate = fixturePage(`<main>Article</main>`);
    tooLate.appendAt(9_000, FIXTURES.complianz.html);
    expect(await cookieBannerAgent(COOKIE_BANNER_RULES, tooLate.dom, OPTIONS)).toEqual({ cmp: null, outcome: "none" });
    expect(tooLate.clicks).toEqual([]);
  });

  it("does nothing when the CMP's banner is not shown (consent already given)", async () => {
    const page = fixturePage(`<div id="onetrust-consent-sdk"><div id="onetrust-banner-sdk" style="display: none"><button id="onetrust-reject-all-handler">Tout refuser</button></div></div>`);
    expect(await cookieBannerAgent(COOKIE_BANNER_RULES, page.dom, OPTIONS)).toEqual({ cmp: "onetrust", outcome: "none" });
    expect(page.clicks).toEqual([]);
  });

  it("is self-contained: its source evaluates on its own (it is sent to the page as text)", async () => {
    const standalone = new Function(`return (${String(cookieBannerAgent)});`)() as typeof cookieBannerAgent;
    const page = fixturePage(FIXTURES.osano.html);
    expect(await standalone(COOKIE_BANNER_RULES, page.dom, OPTIONS)).toEqual({ cmp: "osano", outcome: "rejected" });
  });

  it("validates what the page answers", () => {
    expect(sanitizeBannerResult({ cmp: "didomi", outcome: "rejected" })).toEqual({ cmp: "didomi", outcome: "rejected" });
    expect(sanitizeBannerResult({ cmp: "<img>", outcome: "hidden" })).toEqual({ cmp: null, outcome: "hidden" });
    expect(sanitizeBannerResult({ outcome: "accepted" })).toBeNull();
    expect(sanitizeBannerResult("rejected")).toBeNull();
    expect(bannerHandled({ cmp: null, outcome: "hidden" })).toBe(true);
    expect(bannerHandled({ cmp: "didomi", outcome: "none" })).toBe(false);
  });
});
