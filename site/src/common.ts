/** Shared by every page: header (scroll state, mobile menu, active link) and reveal on scroll. */

export const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

document.documentElement.classList.add("js");

// ---------- Header ----------

const header = document.querySelector<HTMLElement>(".topbar");
const menuButton = document.getElementById("menu-toggle");
const menu = document.getElementById("site-menu");

function setScrolled(): void {
  header?.classList.toggle("scrolled", scrollY > 8);
}
setScrolled();
addEventListener("scroll", setScrolled, { passive: true });

function setMenu(open: boolean): void {
  if (!menuButton || !menu) return;
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
  header?.classList.toggle("menu-open", open);
  document.body.classList.toggle("no-scroll", open);
}
menuButton?.addEventListener("click", () => setMenu(menuButton.getAttribute("aria-expanded") !== "true"));
menu?.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).closest("a")) setMenu(false);
});
addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menuButton?.getAttribute("aria-expanded") === "true") {
    setMenu(false);
    menuButton.focus();
  }
});
matchMedia("(min-width: 960px)").addEventListener("change", (e) => e.matches && setMenu(false));

/**
 * Highlights the link of the section in view (`aria-current`): `links` point to `#id` anchors.
 * The section whose top last crossed the upper third of the viewport wins.
 */
export function trackActiveLinks(links: HTMLAnchorElement[]): void {
  const targets = links
    .map((link) => ({ link, section: document.getElementById(decodeURIComponent(link.hash.slice(1))) }))
    .filter((t): t is { link: HTMLAnchorElement; section: HTMLElement } => Boolean(t.section));
  if (!targets.length) return;
  let frame = 0;
  const update = (): void => {
    frame = 0;
    const line = innerHeight * 0.35;
    let current: (typeof targets)[number] | undefined;
    for (const t of targets) {
      if (t.section.offsetParent === null) continue; // Hidden (docs search filter).
      const rect = t.section.getBoundingClientRect();
      if (rect.top <= line && rect.bottom > 0) current = t;
    }
    for (const t of targets) {
      if (t === current) t.link.setAttribute("aria-current", "true");
      else t.link.removeAttribute("aria-current");
    }
  };
  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule, { passive: true });
  update();
}

// ---------- Reveal on scroll ----------

export function setupReveal(selector: string): void {
  const items = document.querySelectorAll<HTMLElement>(selector);
  if (!("IntersectionObserver" in window) || reducedMotion.matches) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "0px 0px -10% 0px" },
  );
  for (const el of items) {
    // Already on screen at load: shown immediately, no flash.
    if (el.getBoundingClientRect().top < innerHeight * 0.9) continue;
    el.classList.add("reveal");
    observer.observe(el);
  }
}
