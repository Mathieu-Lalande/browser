/**
 * Cookie banner rules (ADR-046): pure data, in the spirit of Consent-O-Matic and "I still don't care
 * about cookies" (reject mode). Each rule recognizes one consent management platform (CMP) and
 * lists ways to refuse — "Tout refuser", "Continuer sans accepter", or the settings saved with
 * only the necessary purposes — tried in order. When none works, the banner is hidden instead
 * (`hide`). A rule never names an "accept" button, and the agent double-checks the label of every
 * button before clicking it.
 *
 * Selectors are plain CSS; `host >>> inner` looks inside `host`'s open shadow root (Usercentrics).
 */

export interface BannerStep {
  /** Elements to click: the first visible one is used (waiting for it a little). */
  click: string;
  /** Among the matches, only one whose label reads as a refusal ("Refuser", "Continuer sans accepter"…). */
  requireReject?: boolean;
  /** Skipped when nothing matches (instead of failing the strategy). */
  optional?: boolean;
}

export interface CookieBannerRule {
  id: string;
  /** The CMP's name, for diagnostics. */
  name: string;
  /** The CMP is on the page when any of these matches (visible or not). */
  detect: string[];
  /** The banner itself: there is something to do only while one of these is visible. */
  banner: string[];
  /** Ways to refuse, tried in order: a strategy is used when its first step finds a visible element. */
  strategies: BannerStep[][];
  /** Fallback: hidden with cosmetic CSS when no strategy works. */
  hide: string[];
  /** Elements whose scrolling the CMP locks (`overflow: hidden`) while the banner shows, released by the fallback. */
  unlock?: string[];
}

const BODY = ["html", "body"];

export const COOKIE_BANNER_RULES: readonly CookieBannerRule[] = [
  {
    id: "onetrust",
    name: "OneTrust",
    detect: ["#onetrust-consent-sdk", "#onetrust-banner-sdk"],
    banner: ["#onetrust-banner-sdk", "#onetrust-pc-sdk"],
    strategies: [
      [{ click: "#onetrust-reject-all-handler" }],
      [{ click: "#onetrust-pc-btn-handler" }, { click: "#onetrust-pc-sdk .ot-pc-refuse-all-handler, #onetrust-pc-sdk .save-preference-btn-handler" }],
    ],
    hide: ["#onetrust-consent-sdk"],
    unlock: BODY,
  },
  {
    id: "didomi",
    name: "Didomi",
    detect: ["#didomi-host", "#didomi-notice"],
    banner: ["#didomi-notice", "#didomi-popup"],
    strategies: [
      [{ click: "#didomi-notice-disagree-button" }],
      [{ click: ".didomi-continue-without-agreeing" }],
      [{ click: "#didomi-popup .didomi-popup-notice-buttons button, #didomi-popup button", requireReject: true }],
    ],
    hide: ["#didomi-host", "#didomi-popup"],
    unlock: BODY,
  },
  {
    id: "quantcast",
    name: "InMobi Choice (Quantcast)",
    detect: ["#qc-cmp2-container", ".qc-cmp2-container", "#qc-cmp2-ui"],
    banner: ["#qc-cmp2-ui"],
    strategies: [
      [{ click: '#qc-cmp2-ui .qc-cmp2-summary-buttons button[mode="secondary"]', requireReject: true }],
      [
        { click: '#qc-cmp2-ui .qc-cmp2-summary-buttons button[mode="secondary"]' },
        { click: "#qc-cmp2-ui .qc-cmp2-header-links button, #qc-cmp2-ui .qc-cmp2-footer button", requireReject: true },
        { click: '#qc-cmp2-ui .qc-cmp2-footer button[mode="primary"]', optional: true },
      ],
    ],
    hide: ["#qc-cmp2-container", ".qc-cmp2-container"],
    unlock: BODY,
  },
  {
    id: "cookiebot",
    name: "Cookiebot",
    detect: ["#CybotCookiebotDialog"],
    banner: ["#CybotCookiebotDialog"],
    strategies: [[{ click: "#CybotCookiebotDialogBodyButtonDecline" }], [{ click: "#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll" }]],
    hide: ["#CybotCookiebotDialog", "#CybotCookiebotDialogBodyUnderlay"],
    unlock: BODY,
  },
  {
    id: "trustarc",
    name: "TrustArc",
    detect: ["#truste-consent-track", "#truste-consent-content", ".truste_box_overlay"],
    banner: ["#truste-consent-track", ".truste_box_overlay"],
    strategies: [[{ click: "#truste-consent-required" }]],
    // The preferences center is a cross-origin frame: out of reach, hidden instead.
    hide: ["#truste-consent-track", ".truste_box_overlay", ".truste_overlay", "#consent_blackbar"],
    unlock: BODY,
  },
  {
    id: "usercentrics",
    name: "Usercentrics",
    detect: ["#usercentrics-root", "#usercentrics-cmp-ui"],
    banner: ["#usercentrics-root >>> [data-testid='uc-banner-content'], #usercentrics-root >>> [role='dialog']", "#usercentrics-cmp-ui >>> #uc-main-dialog, #usercentrics-cmp-ui >>> [role='dialog']"],
    strategies: [
      [{ click: "#usercentrics-root >>> [data-testid='uc-deny-all-button']" }],
      [{ click: "#usercentrics-cmp-ui >>> #deny, #usercentrics-cmp-ui >>> .deny" }],
    ],
    hide: ["#usercentrics-root", "#usercentrics-cmp-ui"],
    unlock: BODY,
  },
  {
    id: "axeptio",
    name: "Axeptio",
    detect: ["#axeptio_overlay", ".axeptio_mount"],
    banner: ["#axeptio_overlay", ".axeptio_mount"],
    strategies: [[{ click: "#axeptio_btn_dismiss" }]],
    hide: ["#axeptio_overlay", ".axeptio_mount"],
  },
  {
    id: "sirdata",
    name: "Sirdata",
    detect: ["#sd-cmp"],
    banner: ["#sd-cmp"],
    // Obfuscated class names: the refusal is found by its label.
    strategies: [[{ click: "#sd-cmp button, #sd-cmp [role='button']", requireReject: true }]],
    hide: ["#sd-cmp"],
    unlock: BODY,
  },
  {
    id: "cookieyes",
    name: "CookieYes",
    detect: [".cky-consent-container", "#cookie-law-info-bar"],
    banner: [".cky-consent-container", "#cookie-law-info-bar"],
    strategies: [[{ click: ".cky-btn-reject" }], [{ click: "#cookie_action_close_header_reject, [data-cli_action='reject']" }]],
    hide: [".cky-consent-container", ".cky-overlay", "#cookie-law-info-bar"],
    unlock: BODY,
  },
  {
    id: "iubenda",
    name: "iubenda",
    detect: ["#iubenda-cs-banner"],
    banner: ["#iubenda-cs-banner"],
    strategies: [[{ click: "#iubenda-cs-banner .iubenda-cs-reject-btn" }]],
    hide: ["#iubenda-cs-banner"],
    unlock: BODY,
  },
  {
    id: "complianz",
    name: "Complianz",
    detect: ["#cmplz-cookiebanner-container", ".cmplz-cookiebanner"],
    banner: [".cmplz-cookiebanner"],
    strategies: [[{ click: ".cmplz-cookiebanner .cmplz-deny" }]],
    hide: ["#cmplz-cookiebanner-container", ".cmplz-cookiebanner", ".cmplz-soft-cookiewall"],
  },
  {
    id: "funding-choices",
    name: "Google Funding Choices",
    detect: [".fc-consent-root"],
    banner: [".fc-consent-root .fc-dialog-container, .fc-consent-root .fc-dialog"],
    strategies: [[{ click: ".fc-consent-root .fc-cta-do-not-consent" }], [{ click: ".fc-consent-root .fc-cta-manage-options" }, { click: ".fc-consent-root .fc-confirm-choices" }]],
    hide: [".fc-consent-root"],
    unlock: BODY,
  },
  {
    id: "klaro",
    name: "Klaro",
    detect: [".klaro .cookie-notice", ".klaro .cookie-modal"],
    banner: [".klaro .cookie-notice", ".klaro .cookie-modal"],
    strategies: [[{ click: ".klaro .cn-decline" }], [{ click: ".klaro .cm-btn-decline" }]],
    hide: [".klaro .cookie-notice", ".klaro .cookie-modal"],
  },
  {
    id: "osano",
    name: "Osano",
    detect: [".osano-cm-window"],
    banner: [".osano-cm-dialog"],
    strategies: [[{ click: ".osano-cm-denyAll, .osano-cm-button--type_denyAll" }]],
    hide: [".osano-cm-window", ".osano-cm-dialog"],
  },
  {
    id: "termly",
    name: "Termly",
    detect: ["#termly-code-snippet-support", "[data-tid='banner-decline']"],
    banner: ["[data-tid='banner-decline']"],
    strategies: [[{ click: "button[data-tid='banner-decline']" }]],
    hide: ["#termly-code-snippet-support"],
  },
];
