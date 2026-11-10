import { keywords, LOCALES, t, translate, type MessageKey } from "../i18n";

/**
 * Searchable index of `browser://settings`: each entry deep-links to its row
 * (`browser://settings#section/row`), which the settings page scrolls to and highlights. The
 * anchors are `data-setting` attributes in the settings components (a test checks they exist).
 */

export interface SettingEntry {
  /** `section/row`, or `section` alone for a whole section. */
  anchor: string;
  label: string;
  section: string;
  keywords: readonly string[];
}

const SECTIONS = {
  appearance: "settingsIndex.section.appearance",
  layout: "settingsIndex.section.layout",
  search: "settingsIndex.section.search",
  startPage: "settingsIndex.section.startPage",
  behavior: "settingsIndex.section.behavior",
  shortcuts: "settingsIndex.section.shortcuts",
  privacy: "settingsIndex.section.privacy",
  autofill: "settingsIndex.section.autofill",
  siteData: "settingsIndex.section.siteData",
  notifications: "settingsIndex.section.notifications",
  translate: "settingsIndex.section.translate",
  assistant: "settingsIndex.section.assistant",
  spellcheck: "settingsIndex.section.spellcheck",
  downloads: "settingsIndex.section.downloads",
  data: "settingsIndex.section.data",
  sync: "settingsIndex.section.sync",
  updates: "settingsIndex.section.updates",
  diagnostics: "settingsIndex.section.diagnostics",
} as const satisfies Record<string, MessageKey>;

type SectionKey = keyof typeof SECTIONS;

/**
 * An entry whose texts follow the UI language (ADR-052): `label` is a catalog key, and
 * `${label}Keywords` its search terms (French and English, whatever the language).
 */
const entry = (section: SectionKey, row: string | null, label: MessageKey): SettingEntry => ({
  anchor: row ? `${section}/${row}` : section,
  get label() {
    return t(label);
  },
  get section() {
    return t(SECTIONS[section]);
  },
  get keywords() {
    // The label in every language too: a setting is found by its French and English names.
    return [...keywords(`${label}Keywords` as MessageKey), ...LOCALES.map((locale) => translate(locale, label))];
  },
});

export const SETTINGS_INDEX: readonly SettingEntry[] = [
  entry("appearance", "language", "settingsIndex.appearance.language"),
  entry("appearance", "theme", "settingsIndex.appearance.theme"),
  entry("appearance", "accent", "settingsIndex.appearance.accent"),
  entry("appearance", "secondary", "settingsIndex.appearance.secondary"),
  entry("appearance", "background", "settingsIndex.appearance.background"),
  entry("appearance", "font", "settingsIndex.appearance.font"),
  entry("appearance", "density", "settingsIndex.appearance.density"),
  entry("appearance", "radius", "settingsIndex.appearance.radius"),
  entry("appearance", "shadows", "settingsIndex.appearance.shadows"),
  entry("appearance", "reduce-motion", "settingsIndex.appearance.reduceMotion"),
  entry("appearance", "hand-cursor", "settingsIndex.appearance.handCursor"),
  entry("appearance", "dynamic-theme", "settingsIndex.appearance.dynamicTheme"),
  entry("appearance", "mica", "settingsIndex.appearance.mica"),
  entry("appearance", "page-zoom", "settingsIndex.appearance.pageZoom"),
  entry("layout", "sidebar-position", "settingsIndex.layout.sidebarPosition"),
  entry("layout", "sidebar-width", "settingsIndex.layout.sidebarWidth"),
  entry("layout", "gutter", "settingsIndex.layout.gutter"),
  entry("layout", "zen", "settingsIndex.layout.zen"),
  entry("layout", "tab-preview", "settingsIndex.layout.tabPreview"),
  entry("search", "engine", "settingsIndex.search.engine"),
  entry("startPage", "name", "settingsIndex.startPage.name"),
  entry("startPage", "widgets", "settingsIndex.startPage.widgets"),
  entry("startPage", "background", "settingsIndex.startPage.background"),
  entry("behavior", "default-browser", "settingsIndex.behavior.defaultBrowser"),
  entry("behavior", "restore-session", "settingsIndex.behavior.restoreSession"),
  entry("behavior", "new-tab-position", "settingsIndex.behavior.newTabPosition"),
  entry("behavior", "after-close", "settingsIndex.behavior.afterClose"),
  entry("behavior", "sleep", "settingsIndex.behavior.sleep"),
  entry("behavior", "archive", "settingsIndex.behavior.archive"),
  entry("behavior", "auto-pip", "settingsIndex.behavior.autoPip"),
  entry("behavior", "energy-saver", "settingsIndex.behavior.energySaver"),
  entry("behavior", "mini-window", "settingsIndex.behavior.miniWindow"),
  entry("shortcuts", null, "settingsIndex.shortcuts.section"),
  entry("privacy", "weather", "settingsIndex.privacy.weather"),
  entry("privacy", "accept-language", "settingsIndex.privacy.acceptLanguage"),
  entry("privacy", "cookie-banners", "settingsIndex.privacy.cookieBanners"),
  entry("privacy", "fingerprinting", "settingsIndex.privacy.fingerprinting"),
  entry("privacy", "secure-dns", "settingsIndex.privacy.secureDns"),
  entry("privacy", "privacy-pages", "settingsIndex.privacy.privacyPages"),
  entry("privacy", "drm", "settingsIndex.privacy.drm"),
  entry("siteData", "third-party-cookies", "settingsIndex.siteData.thirdPartyCookies"),
  entry("siteData", null, "settingsIndex.siteData.section"),
  entry("translate", "provider", "settingsIndex.translate.provider"),
  entry("translate", "target", "settingsIndex.translate.target"),
  entry("translate", "offer", "settingsIndex.translate.offer"),
  entry("assistant", "enabled", "settingsIndex.assistant.enabled"),
  entry("assistant", "api-key", "settingsIndex.assistant.apiKey"),
  entry("assistant", "model", "settingsIndex.assistant.model"),
  entry("autofill", "addresses", "settingsIndex.autofill.addresses"),
  entry("autofill", "cards", "settingsIndex.autofill.cards"),
  entry("autofill", "sync-addresses", "settingsIndex.autofill.syncAddresses"),
  entry("autofill", "card-list", "settingsIndex.autofill.cardList"),
  entry("notifications", "do-not-disturb", "settingsIndex.notifications.doNotDisturb"),
  entry("spellcheck", "enabled", "settingsIndex.spellcheck.enabled"),
  entry("spellcheck", "languages", "settingsIndex.spellcheck.languages"),
  entry("spellcheck", "words", "settingsIndex.spellcheck.words"),
  entry("downloads", "folder", "settingsIndex.downloads.folder"),
  entry("downloads", "ask-where", "settingsIndex.downloads.askWhere"),
  entry("downloads", "executables", "settingsIndex.downloads.executables"),
  entry("data", "import", "settingsIndex.data.import"),
  entry("data", "history", "settingsIndex.data.history"),
  entry("data", "bookmarks", "settingsIndex.data.bookmarks"),
  entry("sync", null, "settingsIndex.sync.section"),
  entry("sync", "annotations", "settingsIndex.sync.annotations"),
  entry("sync", "passwords", "settingsIndex.sync.passwords"),
  entry("sync", "panels", "settingsIndex.sync.panels"),
  entry("updates", null, "settingsIndex.updates.section"),
  entry("updates", "beta", "settingsIndex.updates.beta"),
  entry("diagnostics", "crash-reports", "settingsIndex.diagnostics.crashReports"),
  entry("diagnostics", "crashes", "settingsIndex.diagnostics.crashes"),
  entry("diagnostics", "report-issue", "settingsIndex.diagnostics.reportIssue"),
];

/** `browser://settings#…` for an entry. */
export const settingUrl = (entry: SettingEntry) => `browser://settings#${entry.anchor}`;
