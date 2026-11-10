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
    // Multi-page: the showcase (index.html) and the user guide (docs.html), both in dist/.
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        docs: fileURLToPath(new URL("./docs.html", import.meta.url)),
        // Linked from the App Store and Google Play listings (mobile/store/).
        privacy: fileURLToPath(new URL("./privacy.html", import.meta.url)),
        support: fileURLToPath(new URL("./support.html", import.meta.url)),
        // English versions (ADR-052): same pages under /en/, linked by hreflang alternates.
        "en/main": fileURLToPath(new URL("./en/index.html", import.meta.url)),
        "en/docs": fileURLToPath(new URL("./en/docs.html", import.meta.url)),
        "en/privacy": fileURLToPath(new URL("./en/privacy.html", import.meta.url)),
        "en/support": fileURLToPath(new URL("./en/support.html", import.meta.url)),
      },
    },
  },
});
