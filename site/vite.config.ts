import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const iconsDir = fileURLToPath(new URL("./node_modules/lucide-static/icons/", import.meta.url));

/**
 * Inlines Lucide icons at build time: `<i data-icon="download"></i>` becomes the SVG from
 * `lucide-static` (decorative, `aria-hidden`), so the page ships no icon font nor runtime.
 * An unknown icon name fails the build.
 */
function lucideIcons(): Plugin {
  return {
    name: "lucide-inline",
    transformIndexHtml(html) {
      return html.replace(/<i data-icon="([a-z0-9-]+)"(?: class="([^"]*)")?><\/i>/g, (_, name: string, extra?: string) => {
        const svg = readFileSync(`${iconsDir}${name}.svg`, "utf8")
          .replace(/<!--[\s\S]*?-->\s*/, "")
          .replace(/class="[^"]*"/, `class="icon${extra ? ` ${extra}` : ""}" aria-hidden="true" focusable="false"`)
          .replace(/\s*width="24"\s*height="24"/, "")
          .replace(/\n\s*/g, " ")
          .replace(/\s*\/>/g, "/>")
          .replace(/<svg\s+/, "<svg ")
          .trim();
        return svg;
      });
    },
  };
}

// Served by GitHub Pages at https://mathieu-lalande.github.io/browser/ (ADR-023).
export default defineConfig({
  base: process.env.SITE_BASE ?? "/browser/",
  plugins: [lucideIcons()],
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
  },
});
