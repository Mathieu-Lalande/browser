import "./style.css";
import "./docs.css";
import { setupReveal, trackActiveLinks } from "./common";

const tocLinks = [...document.querySelectorAll<HTMLAnchorElement>(".toc a[href^='#']")];
trackActiveLinks(tocLinks);
setupReveal(".doc-section");

// ---------- Search filter ----------
// Hides the sections (and their table-of-contents links) that do not contain every typed word.

const input = document.getElementById("doc-search") as HTMLInputElement | null;
const status = document.getElementById("doc-search-status");
const sections = [...document.querySelectorAll<HTMLElement>(".doc-section")];
const normalize = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
const index = sections.map((section) => normalize(section.textContent ?? ""));

function filter(): void {
  const words = normalize(input?.value ?? "")
    .split(/\s+/)
    .filter(Boolean);
  let shown = 0;
  sections.forEach((section, i) => {
    const match = words.every((word) => index[i].includes(word));
    section.hidden = !match;
    if (match) shown++;
    for (const link of tocLinks) {
      if (link.hash === `#${section.id}`) link.parentElement!.hidden = !match;
    }
  });
  if (status) {
    status.textContent = words.length
      ? shown
        ? `${shown} section${shown > 1 ? "s" : ""} correspond${shown > 1 ? "ent" : ""}`
        : "Aucune section ne correspond"
      : "";
  }
}
input?.addEventListener("input", filter);
addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement;
  if (event.key === "/" && !/INPUT|TEXTAREA/.test(target.tagName)) {
    event.preventDefault();
    input?.focus();
  } else if (event.key === "Escape" && target === input && input.value) {
    input.value = "";
    filter();
  }
});
