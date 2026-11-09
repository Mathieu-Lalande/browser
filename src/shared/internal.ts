/**
 * Internal pages (`browser://…`) are rendered by the chrome UI inside a tab, never loaded in a
 * WebContentsView. Only the user can open them (address bar, menus, sidebar): `isNavigableUrl`
 * refuses the scheme, so web pages can neither navigate to, open, nor redirect to them.
 */

import { t } from "./i18n";

export const INTERNAL_PAGES = {
  settings: { get title() { return t("internal.settings") } },
  downloads: { get title() { return t("internal.downloads") } },
  archive: { get title() { return t("internal.archivedTabs") } },
  extensions: { get title() { return t("internal.extensions") } },
  passwords: { get title() { return t("internal.passwords") } },
  boosts: { get title() { return t("internal.boosts") } },
  notes: { get title() { return t("internal.notesHighlights") } },
  history: { get title() { return t("internal.history") } },
  import: { get title() { return t("internal.importData") } },
  tasks: { get title() { return t("internal.taskManager") } },
  profiles: { get title() { return t("internal.profiles") } },
  welcome: { get title() { return t("internal.welcome") } },
  privacy: { get title() { return t("internal.privacy") } },
  "site-settings": { get title() { return t("internal.siteSettings") } },
  "reading-list": { get title() { return t("internal.readingList") } },
} as const;

export type InternalPage = keyof typeof INTERNAL_PAGES;

const INTERNAL_PROTOCOL = "browser:";

/** A deep link inside an internal page: `section/row` (letters, digits, `-`, `_`, `/`). */
const FRAGMENT = /^[a-z\d_-]+(?:\/[a-z\d_-]+)?$/i;

export const internalUrl = (page: InternalPage, fragment?: string | null) =>
  `browser://${page}${fragment && FRAGMENT.test(fragment) ? `#${fragment}` : ""}`;

/**
 * The internal page an URL (or typed text) designates, if any: `browser://settings`, any case,
 * optional `/`, optional deep link (`browser://settings#appearance/page-zoom`, ADR-032).
 */
export function internalPageOf(url: string): InternalPage | null {
  const match = /^browser:\/\/([a-z]+(?:-[a-z]+)*)\/?(?:#(.*))?$/i.exec(url.trim());
  const page = match?.[1].toLowerCase();
  if (match?.[2] !== undefined && !FRAGMENT.test(match[2])) return null;
  return page && Object.hasOwn(INTERNAL_PAGES, page) ? (page as InternalPage) : null;
}

/** The deep link of an internal page URL (`appearance/page-zoom`), null without one. */
export function internalFragment(url: string): string | null {
  if (!internalPageOf(url)) return null;
  const hash = url.trim().split("#")[1];
  return hash || null;
}

/** Anything using the internal scheme, known page or not. */
export function isInternalUrl(url: string): boolean {
  return url.trim().toLowerCase().startsWith(INTERNAL_PROTOCOL);
}
