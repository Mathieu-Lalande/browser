/**
 * "Ranger les onglets" (ADR-059): a proposal of folders for the loose tabs of a space. With the
 * assistant on (ADR-044), Claude names topics; otherwise tabs are grouped by site. Pure: the
 * prompt, the answer's validation and the site grouping. The user reviews before anything moves.
 */

export interface TidyTab {
  id: string;
  title: string;
  url: string;
}

export interface TidyGroup {
  name: string;
  tabIds: string[];
}

/** "loose": tabs outside folders; "all": every unpinned tab, folders included (a full reorganization). */
export type TidyScope = "loose" | "all";

export interface TidyProposal {
  /** "ai": named by the assistant; "local": grouped on this device (shared words of titles, then sites). */
  source: "ai" | "local";
  scope: TidyScope;
  groups: TidyGroup[];
  /** How many tabs were looked at. */
  considered: number;
  /** Tabs filed in folders that "all" would also look at (0 when `scope` is "all"). */
  inFolders: number;
  /** Whether the assistant can name topics (on, acknowledged, with a key, normal window). */
  assistantReady: boolean;
  /** Why the assistant was not used, when it was asked and failed. */
  notice?: string;
}

export const TIDY_MIN_TABS = 4;
export const TIDY_MAX_TABS = 120;
export const TIDY_MAX_GROUPS = 8;
const MAX_NAME = 40;

const siteOf = (url: string): string | null => {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? hostname.replace(/^www\./u, "") : null;
  } catch {
    return null;
  }
};

// prettier-ignore
const STOP_WORDS = new Set([ // i18n-ignore
  "avec", "dans", "pour", "plus", "sans", "sous", "votre", "vous", "nous", "leur", "cette", "comment", "quoi", "tout", "tous", "toute", // i18n-ignore
  "accueil", "recherche", "rechercher", "google", "bing", "qwant", "duckduckgo", "page", "pages", "site", "officiel", "officielle", // i18n-ignore
  "home", "search", "with", "from", "your", "this", "that", "what", "about", "login", "connexion", "compte", "account", "welcome", // i18n-ignore
  "bienvenue", "nouvel", "onglet", "new", "tab", "index", "untitled", "sans", "titre", "www", "http", "https", "html", // i18n-ignore
]);

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();

/** The words a tab is about: its title's words and its site's name, accents folded, short and common words left out. */
export function tabWords(tab: TidyTab): Set<string> {
  const words = new Set<string>();
  for (const word of fold(tab.title).split(/[^\p{L}\p{N}]+/u)) if (word.length >= 4 && !STOP_WORDS.has(word) && !/^\d+$/u.test(word)) words.add(word);
  const site = siteOf(tab.url);
  // "woodflip.fr" → "woodflip"; "mail.google.com" → "google" is a stop word, kept out.
  const name = site?.split(".").slice(-2, -1)[0];
  if (name && name.length >= 4 && !STOP_WORDS.has(name)) words.add(fold(name));
  return words;
}

const capitalize = (word: string) => word.charAt(0).toLocaleUpperCase() + word.slice(1);

/**
 * Grouping without the assistant: tabs sharing a word (title or site name: "WoodFlip – Figurines",
 * "woodflip - Recherche Google", "deepl - woodflip") form a topic, the word naming it; the tabs
 * left are grouped by site. Each tab once, groups of 2+, the biggest first.
 */
export function groupLocally(tabs: readonly TidyTab[]): TidyGroup[] {
  const words = new Map(tabs.map((tab) => [tab.id, tabWords(tab)]));
  const left = new Set(tabs.map((tab) => tab.id));
  const groups: TidyGroup[] = [];
  while (groups.length < TIDY_MAX_GROUPS) {
    const counts = new Map<string, string[]>();
    for (const id of left) for (const word of words.get(id) ?? []) counts.set(word, [...(counts.get(word) ?? []), id]);
    const best = [...counts].filter(([, ids]) => ids.length >= 2).sort((a, b) => b[1].length - a[1].length || b[0].length - a[0].length || a[0].localeCompare(b[0]))[0];
    if (!best) break;
    groups.push({ name: capitalize(best[0]).slice(0, MAX_NAME), tabIds: best[1] });
    for (const id of best[1]) left.delete(id);
  }
  const rest = tabs.filter((tab) => left.has(tab.id));
  return [...groups, ...groupBySite(rest)].slice(0, TIDY_MAX_GROUPS);
}

/** Groups of at least two tabs of the same site, biggest first (fallback without the assistant). */
export function groupBySite(tabs: readonly TidyTab[]): TidyGroup[] {
  const bySite = new Map<string, string[]>();
  for (const tab of tabs) {
    const site = siteOf(tab.url);
    if (site) bySite.set(site, [...(bySite.get(site) ?? []), tab.id]);
  }
  return [...bySite]
    .filter(([, ids]) => ids.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, TIDY_MAX_GROUPS)
    .map(([site, tabIds]) => ({ name: site, tabIds }));
}

/** The user message: numbered tabs, title and site only (never the full URL: no query strings). */
export function tidyPrompt(tabs: readonly TidyTab[], language: "fr" | "en"): string {
  const lines = tabs.slice(0, TIDY_MAX_TABS).map((tab, index) => `${index + 1}. ${tab.title.slice(0, 120)} — ${siteOf(tab.url) ?? "?"}`);
  const lang = language === "fr" ? "French" : "English";
  return [
    `Group these browser tabs into at most ${TIDY_MAX_GROUPS} folders by topic or task.`,
    "Each folder holds at least 2 tabs; leave a tab out when it fits no folder.",
    `Folder names: ${lang}, 1 to 3 words, no emoji, no punctuation at the end.`,
    "Answer with the tab numbers only.",
    "",
    ...lines,
  ].join("\n");
}

/** The JSON schema of the structured answer. */
export const TIDY_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, tabs: { type: "array", items: { type: "integer" } } },
        required: ["name", "tabs"],
        additionalProperties: false,
      },
    },
  },
  required: ["groups"],
  additionalProperties: false,
} as const;

/** Validates the assistant's answer: known numbers, each tab once, groups of 2+, trimmed names. */
export function parseTidyAnswer(text: string, tabs: readonly TidyTab[]): TidyGroup[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const raw = (data as { groups?: unknown })?.groups;
  if (!Array.isArray(raw)) return [];
  const used = new Set<string>();
  const groups: TidyGroup[] = [];
  for (const entry of raw) {
    const name = typeof entry?.name === "string" ? entry.name.trim().replace(/\s+/gu, " ").slice(0, MAX_NAME) : "";
    if (!name || !Array.isArray(entry.tabs)) continue;
    const tabIds: string[] = [];
    for (const number of entry.tabs) {
      const tab = Number.isInteger(number) ? tabs[number - 1] : undefined;
      if (tab && !used.has(tab.id)) {
        used.add(tab.id);
        tabIds.push(tab.id);
      }
    }
    if (tabIds.length >= 2) groups.push({ name, tabIds });
    if (groups.length === TIDY_MAX_GROUPS) break;
  }
  return groups;
}
