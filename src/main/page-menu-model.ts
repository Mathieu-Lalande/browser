import { isNavigableUrl, isPageOpenableUrl, normalizeInput, searchUrl, type SearchEngine } from "@shared/url";

/**
 * The web page context menu (ADR-021), as plain data: which entries a right click gets, from
 * Chromium's `context-menu` parameters. Pure (no Electron at runtime) so it is unit-tested;
 * `./page-menu.ts` turns it into a native menu and runs the entries.
 *
 * Every URL the page hands over (link, image, selection) is checked here: only what a page may
 * open (`isPageOpenableUrl`: http, https, about:blank) can be opened, never `file:`, `javascript:`
 * or `browser:`.
 */

/** What the menu reads from Electron's `ContextMenuParams`. */
export interface PageMenuParams {
  linkURL: string;
  linkText: string;
  srcURL: string;
  mediaType: string;
  hasImageContents: boolean;
  isEditable: boolean;
  selectionText: string;
  misspelledWord: string;
  dictionarySuggestions: string[];
  editFlags: { canUndo: boolean; canRedo: boolean; canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean };
  mediaFlags: { isPaused: boolean; isMuted: boolean; isLooping: boolean; hasAudio: boolean; canShowPictureInPicture: boolean };
}

export interface PageMenuContext {
  canGoBack: boolean;
  canGoForward: boolean;
  isPrivate: boolean;
  /** Other spaces of the window a link can open in (none in a private window). */
  spaces: { id: string; name: string }[];
  /** The split can take one more tab. */
  canSplit: boolean;
  engine: SearchEngine;
  /** Passwords are saved for the page's origin (ADR-025): fields offer to fill them. */
  hasPasswords?: boolean;
}

export type PageMenuEntry =
  | { id: string; label: string; enabled?: boolean; checked?: boolean; submenu?: PageMenuEntry[] }
  | { separator: true };

/** Longest selection quoted in "Rechercher « … »". */
const QUOTE_MAX = 32;

const quote = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > QUOTE_MAX ? `${flat.slice(0, QUOTE_MAX - 1)}…` : flat;
};

const isWebUrl = (url: string) => /^https?:/i.test(url);

/**
 * The address a selected text designates ("example.com/page", "https://…"), or null when it reads
 * as words to search for, or would not be a web page.
 */
export function selectionAddress(text: string, engine: SearchEngine): string | null {
  const input = text.trim();
  if (!input || /\s/.test(input) || input.length > 2048) return null;
  const url = normalizeInput(input, engine);
  return url !== searchUrl(input, engine) && isPageOpenableUrl(url) && isWebUrl(url) ? url : null;
}

/** The entries of the context menu for a right click described by `params`. */
export function buildPageMenu(params: PageMenuParams, context: PageMenuContext): PageMenuEntry[] {
  const sections: PageMenuEntry[][] = [];
  const editable = params.isEditable;
  const selection = params.selectionText.trim();

  if (editable && params.misspelledWord) {
    const suggestions: PageMenuEntry[] = params.dictionarySuggestions.slice(0, 5).map((word, index) => ({ id: `spell-${index}`, label: word }));
    if (!suggestions.length) suggestions.push({ id: "spell-none", label: "Aucune suggestion", enabled: false });
    // Adding a word writes the profile's dictionary: never from a private window.
    if (!context.isPrivate) suggestions.push({ id: "spell-add", label: "Ajouter au dictionnaire" });
    sections.push(suggestions);
  }

  const link = params.linkURL;
  if (link) {
    const openable = isPageOpenableUrl(link);
    const items: PageMenuEntry[] = [];
    if (openable) {
      items.push(
        { id: "link-open-tab", label: "Ouvrir dans un nouvel onglet" },
        { id: "link-open-background", label: "Ouvrir en arrière-plan" },
        { id: "link-open-split", label: "Ouvrir en vue scindée", enabled: context.canSplit },
      );
      if (!context.isPrivate) {
        items.push({
          id: "link-open-space",
          label: "Ouvrir dans l'espace",
          enabled: context.spaces.length > 0,
          submenu: context.spaces.map((space) => ({ id: `link-open-space:${space.id}`, label: space.name })),
        });
      }
      items.push({ id: "link-open-private", label: context.isPrivate ? "Ouvrir dans une nouvelle fenêtre privée" : "Ouvrir dans une fenêtre privée" });
    }
    // A `javascript:` link is code, not an address: it is not offered for pasting elsewhere.
    if (!/^\s*javascript:/i.test(link)) items.push({ id: "link-copy", label: "Copier le lien" });
    if (params.linkText.trim()) items.push({ id: "link-copy-text", label: "Copier le texte du lien" });
    if (items.length) sections.push(items);
  }

  const src = params.srcURL;
  if (params.mediaType === "image" && (src || params.hasImageContents)) {
    sections.push([
      { id: "image-open", label: "Ouvrir l'image dans un nouvel onglet", enabled: isPageOpenableUrl(src) && isWebUrl(src) },
      { id: "image-copy", label: "Copier l'image", enabled: params.hasImageContents },
      { id: "image-copy-url", label: "Copier l'adresse de l'image", enabled: isWebUrl(src) },
      // Through the downloads module, in the tab's session: dangerous types are confirmed first.
      { id: "image-save", label: "Enregistrer l'image sous…", enabled: isWebUrl(src) || /^data:image\//i.test(src) },
    ]);
  }

  if (params.mediaType === "video" || params.mediaType === "audio") {
    const flags = params.mediaFlags;
    const media: PageMenuEntry[] = [
      { id: "media-play", label: flags.isPaused ? "Lecture" : "Pause" },
      { id: "media-mute", label: "Muet", checked: flags.isMuted },
      { id: "media-loop", label: "Boucle", checked: flags.isLooping },
    ];
    if (params.mediaType === "video") media.push({ id: "media-pip", label: "Image dans l'image", enabled: flags.canShowPictureInPicture });
    sections.push(media);
  }

  if (editable && context.hasPasswords) sections.push([{ id: "password-fill", label: "Remplir le mot de passe" }]);

  if (editable) {
    const flags = params.editFlags;
    sections.push([
      { id: "edit-undo", label: "Annuler", enabled: flags.canUndo },
      { id: "edit-redo", label: "Rétablir", enabled: flags.canRedo },
      { separator: true },
      { id: "edit-cut", label: "Couper", enabled: flags.canCut },
      { id: "edit-copy", label: "Copier", enabled: flags.canCopy },
      { id: "edit-paste", label: "Coller", enabled: flags.canPaste },
      { id: "edit-paste-plain", label: "Coller sans mise en forme", enabled: flags.canPaste },
      { id: "edit-select-all", label: "Tout sélectionner", enabled: flags.canSelectAll },
    ]);
  }

  if (selection) {
    const items: PageMenuEntry[] = [];
    if (!editable) items.push({ id: "selection-copy", label: "Copier" });
    items.push({ id: "selection-search", label: `Rechercher « ${quote(selection)} » avec ${context.engine.name}` });
    if (selectionAddress(selection, context.engine)) items.push({ id: "selection-open", label: "Ouvrir comme adresse" });
    sections.push(items);
  }

  // A plain right click on the page: navigation and page tools.
  if (!sections.length) {
    sections.push(
      [
        { id: "page-back", label: "Précédent", enabled: context.canGoBack },
        { id: "page-forward", label: "Suivant", enabled: context.canGoForward },
        { id: "page-reload", label: "Actualiser" },
      ],
      [
        { id: "page-save", label: "Enregistrer la page sous…" },
        { id: "page-copy-url", label: "Copier l'adresse de la page" },
        { id: "page-site-info", label: "Infos sur le site" },
      ],
    );
  }
  sections.push([{ id: "inspect", label: "Inspecter" }]);

  return sections.flatMap((section, index) => (index ? [{ separator: true } as const, ...section] : section));
}

/** Whether a URL from the page may be downloaded by "Enregistrer…" (web or inline image data). */
export const isSavableUrl = (url: string) => isNavigableUrl(url) && (isWebUrl(url) || /^data:image\//i.test(url));
