import "./style.css";
import { reducedMotion, setupReveal, trackActiveLinks } from "./common";
import { setupDownloads } from "./download";

trackActiveLinks([...document.querySelectorAll<HTMLAnchorElement>('.nav-links a[href^="#"]')]);
setupReveal(".reveal-on-scroll");
void setupDownloads();

// ---------- Parallax ----------
// Layers carry `data-depth` (scroll speed factor) and optionally `data-tilt` (pointer factor, px).
// One rAF per frame, transform only; nothing runs with reduced motion.

const layers = [...document.querySelectorAll<HTMLElement>("[data-depth]")];
let pointerX = 0;
let pointerY = 0;
let frame = 0;
let enabled = false;

function render(): void {
  frame = 0;
  if (!enabled) return;
  const y = scrollY;
  for (const layer of layers) {
    const box = layer.dataset.box ? layer.closest<HTMLElement>(layer.dataset.box) : null;
    // Section layers move relative to their section's center; hero layers to the page top.
    const origin = box ? box.offsetTop + box.offsetHeight / 2 - innerHeight / 2 : 0;
    const depth = Number(layer.dataset.depth) || 0;
    const tilt = Number(layer.dataset.tilt) || 0;
    const ty = (y - origin) * depth + pointerY * tilt;
    const tx = pointerX * tilt;
    layer.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0)`;
  }
}
function schedule(): void {
  if (!frame) frame = requestAnimationFrame(render);
}
function onPointer(event: PointerEvent): void {
  if (event.pointerType !== "mouse") return;
  pointerX = event.clientX / innerWidth - 0.5;
  pointerY = event.clientY / innerHeight - 0.5;
  schedule();
}
function setParallax(): void {
  enabled = !reducedMotion.matches;
  if (enabled) {
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule, { passive: true });
    addEventListener("pointermove", onPointer, { passive: true });
    schedule();
  } else {
    removeEventListener("scroll", schedule);
    removeEventListener("resize", schedule);
    removeEventListener("pointermove", onPointer);
    for (const layer of layers) layer.style.transform = "";
  }
}
setParallax();
reducedMotion.addEventListener("change", setParallax);

// ---------- Pinned storytelling ----------
// The mockup stays pinned (CSS sticky) while the steps scroll; the step crossing the middle of the
// viewport selects the screenshot shown.

const steps = [...document.querySelectorAll<HTMLElement>(".story-step")];
const shots = [...document.querySelectorAll<HTMLElement>(".story-shot")];
const dots = [...document.querySelectorAll<HTMLElement>(".story-dots span")];

function showStep(index: number): void {
  steps.forEach((s, i) => s.classList.toggle("active", i === index));
  shots.forEach((s, i) => s.classList.toggle("active", i === index));
  dots.forEach((d, i) => d.classList.toggle("active", i === index));
}
if (steps.length && "IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) showStep(steps.indexOf(entry.target as HTMLElement));
      }
    },
    { rootMargin: "-45% 0px -45% 0px" },
  );
  for (const step of steps) observer.observe(step);
}
showStep(0);
