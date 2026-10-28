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
} as const;

export type InternalPage = keyof typeof INTERNAL_PAGES;

const INTERNAL_PROTOCOL = "browser:";

export const internalUrl = (page: InternalPage) => `browser://${page}`;

/** The internal page an URL (or typed text) designates, if any: `browser://settings`, any case, optional `/`. */
export function internalPageOf(url: string): InternalPage | null {
  const match = /^browser:\/\/([a-z]+)\/?$/i.exec(url.trim());
  const page = match?.[1].toLowerCase();
  return page && Object.hasOwn(INTERNAL_PAGES, page) ? (page as InternalPage) : null;
}

/** Anything using the internal scheme, known page or not. */
export function isInternalUrl(url: string): boolean {
  return url.trim().toLowerCase().startsWith(INTERNAL_PROTOCOL);
}
