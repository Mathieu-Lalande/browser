/**
 * The site's two languages (ADR-052): French pages at the root, English ones under `/en/`. The
 * page's `<html lang>` says which one is shown; scripts take their texts from here.
 */

export type SiteLang = "fr" | "en";

export const lang: SiteLang = document.documentElement.lang.startsWith("en") ? "en" : "fr";

const TEXTS = {
  fr: {
    menuOpen: "Ouvrir le menu",
    menuClose: "Fermer le menu",
    heroVersion: (version: string) => `Version ${version} · Gratuit · Windows, macOS et Linux`,
    downloadVersion: (version: string) => `Version ${version}, pour Windows, macOS et Linux.`,
    alsoFor: "Aussi pour ",
    and: " et ",
    downloadFor: (os: string) => `Télécharger pour ${os}`,
    bits: "64 bits",
    size: (mb: number) => `${mb} Mo`,
    onGitHub: (version: string | undefined) => `Version ${version} sur GitHub`,
    soon: "Téléchargements bientôt disponibles",
    choosePlatform: "Choisir ma plateforme",
    mobileMeta: "Pour ordinateur ; l'app mobile arrive bientôt",
    anyOs: "Windows, macOS ou Linux",
    sections: (count: number) => (count > 1 ? `${count} sections correspondent` : `${count} section correspond`),
    noSection: "Aucune section ne correspond",
    suggestion: "This page is also available in English.",
    suggestionLink: "Read in English",
    dismiss: "Fermer",
  },
  en: {
    menuOpen: "Open the menu",
    menuClose: "Close the menu",
    heroVersion: (version: string) => `Version ${version} · Free · Windows, macOS and Linux`,
    downloadVersion: (version: string) => `Version ${version}, for Windows, macOS and Linux.`,
    alsoFor: "Also for ",
    and: " and ",
    downloadFor: (os: string) => `Download for ${os}`,
    bits: "64-bit",
    size: (mb: number) => `${mb} MB`,
    onGitHub: (version: string | undefined) => `Version ${version} on GitHub`,
    soon: "Downloads coming soon",
    choosePlatform: "Choose my platform",
    mobileMeta: "For computers; the mobile app is coming soon",
    anyOs: "Windows, macOS or Linux",
    sections: (count: number) => (count === 1 ? "1 section matches" : `${count} sections match`),
    noSection: "No section matches",
    suggestion: "Cette page existe aussi en français.",
    suggestionLink: "Lire en français",
    dismiss: "Close",
  },
} as const;

export const text = TEXTS[lang];

const SEEN_KEY = "browser-site-language-suggested";

/**
 * First visit only: when the browser prefers the other language, a banner suggests the same page
 * in it (the `hreflang` alternate). Never a redirect; once shown or dismissed, never again.
 */
export function suggestOtherLanguage(): void {
  let seen = false;
  try {
    seen = localStorage.getItem(SEEN_KEY) !== null;
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    return; // No storage: the banner could not stay dismissed, so it is not shown.
  }
  if (seen) return;
  const other: SiteLang = lang === "fr" ? "en" : "fr";
  const preferred = (navigator.languages?.length ? navigator.languages : [navigator.language]).map((tag) => tag.toLowerCase().split("-")[0]);
  const first = preferred.find((tag) => tag === "fr" || tag === "en");
  if (first !== other) return;
  const alternate = document.querySelector<HTMLLinkElement>(`link[rel="alternate"][hreflang="${other}"]`);
  if (!alternate) return;
  const banner = document.createElement("div");
  banner.className = "lang-banner";
  banner.setAttribute("role", "note");
  banner.lang = other;
  const message = document.createElement("span");
  message.textContent = text.suggestion;
  const link = document.createElement("a");
  link.href = alternate.href;
  link.hreflang = other;
  link.textContent = text.suggestionLink;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "lang-banner-close";
  close.setAttribute("aria-label", text.dismiss);
  close.textContent = "×";
  close.addEventListener("click", () => banner.remove());
  banner.append(message, link, close);
  document.body.prepend(banner);
}
