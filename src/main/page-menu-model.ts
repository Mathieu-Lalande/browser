import { t } from "@shared/i18n";
import { COLOR_LABELS, HIGHLIGHT_COLORS } from "@shared/annotations/model";
import type { CommandId } from "@shared/commands";
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
  /** Saved addresses / cards that fields can be filled with (ADR-041; none in a private window). */
  autofill?: readonly ("address" | "card")[];
  /** The page shows a translation (ADR-036): the entry offers the original back. */
  translated?: boolean;
  /** The page can be annotated (a web page): a selection offers "Surligner" (ADR-037). */
  canAnnotate?: boolean;
  /** The AI assistant is enabled (ADR-044): its entries are offered (selection, page). */
  assistant?: boolean;
  /** The page is in the reading list (ADR-047); null/absent: not offered (a private window). */
  inReadingList?: boolean | null;
  /** The page is bookmarked (the bookmark entry offers to remove it). */
  isBookmarked?: boolean;
  /**
   * Devices of the sync account the page can be sent to (ADR-033); null: no "Envoyer à un appareil"
   * (sync off, or a private window: nothing private is synced).
   */
  devices?: { id: string; name: string }[] | null;
  /** The displayed shortcut of a registry command (its effective accelerator, ADR-028). */
  shortcut?: (id: CommandId) => string | undefined;
}

export type PageMenuEntry =
  | {
      id: string;
      label: string;
      enabled?: boolean;
      checked?: boolean;
      /** A radio item (extension menus, ADR-053); otherwise `checked` makes a checkbox. */
      radio?: boolean;
      /** `data:` image (an extension's icon, ADR-053). */
      icon?: string;
      submenu?: PageMenuEntry[];
      accelerator?: string;
    }
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
    if (!suggestions.length) suggestions.push({ id: "spell-none", label: t("pageMenuModel.noSuggestions"), enabled: false });
    // Adding a word writes the profile's dictionary: never from a private window.
    if (!context.isPrivate) suggestions.push({ id: "spell-add", label: t("pageMenuModel.addDictionary") });
    sections.push(suggestions);
  }

  const link = params.linkURL;
  if (link) {
    const openable = isPageOpenableUrl(link);
    const items: PageMenuEntry[] = [];
    if (openable) {
      items.push(
        { id: "link-peek", label: t("pageMenuModel.linkPreview") },
        { id: "link-open-tab", label: t("pageMenuModel.openNewTab") },
        { id: "link-open-background", label: t("pageMenuModel.openBackground") },
        { id: "link-open-split", label: t("pageMenuModel.openSplitView"), enabled: context.canSplit },
      );
      if (!context.isPrivate) {
        items.push({
          id: "link-open-space",
          label: t("pageMenuModel.openSpace"),
          enabled: context.spaces.length > 0,
          submenu: context.spaces.map((space) => ({ id: `link-open-space:${space.id}`, label: space.name })),
        });
      }
      items.push({ id: "link-open-private", label: context.isPrivate ? t("pageMenuModel.openNewPrivateWindow") : t("pageMenuModel.openPrivateWindow") });
    }
    // A `javascript:` link is code, not an address: it is not offered for pasting elsewhere.
    if (!/^\s*javascript:/i.test(link)) items.push({ id: "link-copy", label: t("pageMenuModel.copyLink") });
    if (params.linkText.trim()) items.push({ id: "link-copy-text", label: t("pageMenuModel.copyLinkText") });
    if (items.length) sections.push(items);
  }

  const src = params.srcURL;
  if (params.mediaType === "image" && (src || params.hasImageContents)) {
    sections.push([
      { id: "image-open", label: t("pageMenuModel.openImageNewTab"), enabled: isPageOpenableUrl(src) && isWebUrl(src) },
      { id: "image-copy", label: t("pageMenuModel.copyImage"), enabled: params.hasImageContents },
      { id: "image-copy-url", label: t("pageMenuModel.copyImageAddress"), enabled: isWebUrl(src) },
      // Through the downloads module, in the tab's session: dangerous types are confirmed first.
      { id: "image-save", label: t("pageMenuModel.saveImage"), enabled: isWebUrl(src) || /^data:image\//i.test(src) },
    ]);
  }

  if (params.mediaType === "video" || params.mediaType === "audio") {
    const flags = params.mediaFlags;
    const media: PageMenuEntry[] = [
      { id: "media-play", label: flags.isPaused ? t("pageMenuModel.play") : t("pageMenuModel.pause") },
      { id: "media-mute", label: t("pageMenuModel.mute"), checked: flags.isMuted },
      { id: "media-loop", label: t("pageMenuModel.loop"), checked: flags.isLooping },
    ];
    if (params.mediaType === "video") media.push({ id: "media-pip", label: t("pageMenuModel.picturePicture"), enabled: flags.canShowPictureInPicture });
    sections.push(media);
  }

  if (editable && (context.hasPasswords || context.autofill?.length)) {
    const fill: PageMenuEntry[] = [];
    if (context.hasPasswords) fill.push({ id: "password-fill", label: t("pageMenuModel.fillPassword") });
    if (context.autofill?.includes("address")) fill.push({ id: "autofill-address", label: t("pageMenuModel.fillAddress") });
    if (context.autofill?.includes("card")) fill.push({ id: "autofill-card", label: t("pageMenuModel.fillPaymentCard") });
    sections.push(fill);
  }

  if (editable) {
    const flags = params.editFlags;
    sections.push([
      { id: "edit-undo", label: t("pageMenuModel.undo"), enabled: flags.canUndo },
      { id: "edit-redo", label: t("pageMenuModel.redo"), enabled: flags.canRedo },
      { separator: true },
      { id: "edit-cut", label: t("pageMenuModel.cut"), enabled: flags.canCut },
      { id: "edit-copy", label: t("pageMenuModel.copy"), enabled: flags.canCopy },
      { id: "edit-paste", label: t("pageMenuModel.paste"), enabled: flags.canPaste },
      { id: "edit-paste-plain", label: t("pageMenuModel.pasteWithoutFormatting"), enabled: flags.canPaste },
      { id: "edit-select-all", label: t("pageMenuModel.selectAll"), enabled: flags.canSelectAll },
    ]);
  }

  if (selection) {
    const items: PageMenuEntry[] = [];
    if (!editable) items.push({ id: "selection-copy", label: t("pageMenuModel.copy") });
    if (!editable && context.canAnnotate) {
      items.push({
        id: "selection-highlight",
        label: t("pageMenuModel.highlight"),
        submenu: HIGHLIGHT_COLORS.map((color) => ({ id: `selection-highlight:${color}`, label: COLOR_LABELS[color] })),
      });
    }
    items.push({ id: "selection-search", label: t("pageMenuModel.search", { p: quote(selection), name: context.engine.name }) });
    if (selectionAddress(selection, context.engine)) items.push({ id: "selection-open", label: t("pageMenuModel.openAddress") });
    sections.push(items);
    if (!editable && context.assistant) {
      sections.push([
        { id: "assistant-explain", label: t("pageMenuModel.explainAssistant") },
        { id: "assistant-translate", label: t("pageMenuModel.translateAssistant") },
      ]);
    }
  }

  // A plain right click on the page: navigation first (with their shortcuts, as a native menu
  // cannot draw a row of icons), then the page tools (ADR-033).
  if (!sections.length) {
    const key = (id: CommandId) => context.shortcut?.(id);
    const devices = context.devices;
    sections.push(
      [
        { id: "page-back", label: t("pageMenuModel.back"), enabled: context.canGoBack, accelerator: key("back") },
        { id: "page-forward", label: t("pageMenuModel.forward"), enabled: context.canGoForward, accelerator: key("forward") },
        { id: "page-reload", label: t("pageMenuModel.reload"), accelerator: key("reload") },
        { id: "page-bookmark", label: context.isBookmarked ? t("pageMenuModel.removeFromBookmarks") : t("pageMenuModel.addBookmarks"), accelerator: key("toggle-bookmark") },
        ...(typeof context.inReadingList === "boolean"
          ? [{ id: "page-reading", label: context.inReadingList ? t("pageMenuModel.removeFromReadingList") : t("pageMenuModel.readLater"), accelerator: key("toggle-reading-list") }]
          : []),
      ],
      [
        { id: "page-save", label: t("pageMenuModel.savePage"), accelerator: key("save-page") },
        { id: "page-select-all", label: t("pageMenuModel.selectAll"), accelerator: "CmdOrCtrl+A" },
        { id: "page-translate", label: context.translated ? t("pageMenuModel.showOriginal") : t("pageMenuModel.translatePage"), accelerator: key("translate-page") },
        ...(context.assistant ? [{ id: "assistant-summarize", label: t("pageMenuModel.summarizeAssistant"), accelerator: key("toggle-assistant") }] : []),
        {
          id: "page-capture",
          label: t("pageMenuModel.screenshot"),
          submenu: [
            { id: "page-capture-visible", label: t("pageMenuModel.visibleArea"), accelerator: key("screenshot-visible") },
            { id: "page-capture-full", label: t("pageMenuModel.fullPage"), accelerator: key("screenshot-full") },
            { id: "page-capture-element", label: t("pageMenuModel.element"), accelerator: key("screenshot-element") },
          ],
        },
        { id: "page-view-source", label: t("pageMenuModel.viewPageSource"), accelerator: key("view-source") },
        ...(devices
          ? [
              {
                id: "page-send",
                label: t("pageMenuModel.sendDevice"),
                enabled: devices.length > 0,
                submenu: devices.length
                  ? devices.map((device) => ({ id: `page-send:${device.id}`, label: device.name }))
                  : [{ id: "page-send-none", label: t("pageMenuModel.noOtherDevices"), enabled: false }],
              },
            ]
          : []),
      ],
      [
        { id: "page-copy-url", label: t("pageMenuModel.copyPageAddress") },
        { id: "page-site-info", label: t("pageMenuModel.siteInfo") },
      ],
    );
  }
  sections.push([{ id: "inspect", label: t("pageMenuModel.inspect"), accelerator: context.shortcut?.("devtools") }]);

  return sections.flatMap((section, index) => (index ? [{ separator: true } as const, ...section] : section));
}

/** Whether a URL from the page may be downloaded by "Enregistrer…" (web or inline image data). */
export const isSavableUrl = (url: string) => isNavigableUrl(url) && (isWebUrl(url) || /^data:image\//i.test(url));
