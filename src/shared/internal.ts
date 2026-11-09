/**
 * Internal pages (`browser://…`) are rendered by the chrome UI inside a tab, never loaded in a
 * WebContentsView. Only the user can open them (address bar, menus, sidebar): `isNavigableUrl`
 * refuses the scheme, so web pages can neither navigate to, open, nor redirect to them.
 */

export const INTERNAL_PAGES = {
  settings: { title: "Paramètres" },
  downloads: { title: "Téléchargements" },
  archive: { title: "Onglets archivés" },
  extensions: { title: "Extensions" },
  passwords: { title: "Mots de passe" },
  boosts: { title: "Boosts" },
  notes: { title: "Notes et surlignages" },
  history: { title: "Historique" },
  import: { title: "Importer des données" },
  tasks: { title: "Gestionnaire de tâches" },
  profiles: { title: "Profils" },
  welcome: { title: "Bienvenue" },
  "reading-list": { title: "Liste de lecture" },
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
