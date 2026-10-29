import "./style.css";

const REPO = "Mathieu-Lalande/browser";
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const DOWNLOAD_FALLBACK = "#telecharger";

type Os = "windows" | "mac" | "linux" | "mobile" | "unknown";
type AssetKey = "win-x64" | "win-arm64" | "win-zip" | "mac-arm64" | "mac-x64" | "linux-appimage" | "linux-deb" | "checksums";

interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}
interface Release {
  tag_name: string;
  html_url: string;
  assets: ReleaseAsset[];
}

/** File names produced by electron-builder (`artifactName` in package.json, ADR-023). */
const ASSET_PATTERNS: Record<AssetKey, RegExp> = {
  "win-x64": /Setup.*x64\.exe$/i,
  "win-arm64": /Setup.*arm64\.exe$/i,
  "win-zip": /win-x64\.zip$/i,
  "mac-arm64": /mac-arm64\.dmg$/i,
  "mac-x64": /mac-x64\.dmg$/i,
  "linux-appimage": /\.AppImage$/i,
  "linux-deb": /\.deb$/i,
  checksums: /^SHA256SUMS\.txt$/i,
};

const OS_LABEL: Record<"windows" | "mac" | "linux", string> = {
  windows: "Windows",
  mac: "macOS",
  linux: "Linux",
};

// ---------- Theme ----------

const root = document.documentElement;
root.classList.add("js");
const toggle = document.getElementById("theme-toggle");

function applyThemeLabel(): void {
  const light = root.dataset.theme === "light";
  toggle?.setAttribute("aria-label", light ? "Passer en thème sombre" : "Passer en thème clair");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#f4f2fa" : "#141318");
}
applyThemeLabel();
toggle?.addEventListener("click", () => {
  root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
  try {
    localStorage.setItem("theme", root.dataset.theme);
  } catch {
    // Storage blocked (private mode): the choice simply lasts for this visit.
  }
  applyThemeLabel();
});

// ---------- Reveal on scroll ----------

const revealed = document.querySelectorAll<HTMLElement>(".section-head, .feature, .card, .platform, .phone, .highlights li");
if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  for (const el of revealed) {
    el.classList.add("reveal");
    observer.observe(el);
  }
}

// ---------- OS detection ----------

async function detectOs(): Promise<{ os: Os; arm: boolean }> {
  const uaData = (navigator as Navigator & {
    userAgentData?: { platform?: string; mobile?: boolean; getHighEntropyValues?(h: string[]): Promise<{ architecture?: string }> };
  }).userAgentData;
  const ua = navigator.userAgent;
  const platform = uaData?.platform ?? "";
  let os: Os = "unknown";
  if (uaData?.mobile || /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) os = "mobile";
  else if (/Windows/i.test(platform) || /Windows/i.test(ua)) os = "windows";
  else if (/mac/i.test(platform) || /Macintosh|Mac OS X/.test(ua)) os = "mac";
  else if (/Linux|CrOS/i.test(platform) || /Linux|X11/.test(ua)) os = "linux";

  let arm = os === "mac"; // Most Macs sold since 2020 are Apple Silicon; Intel is one click away.
  if (uaData?.getHighEntropyValues && (os === "windows" || os === "mac")) {
    try {
      const { architecture } = await uaData.getHighEntropyValues(["architecture"]);
      if (architecture) arm = architecture === "arm";
    } catch {
      // Keep the default.
    }
  }
  return { os, arm };
}

function primaryAssetKey(os: Os, arm: boolean): AssetKey | null {
  if (os === "windows") return arm ? "win-arm64" : "win-x64";
  if (os === "mac") return arm ? "mac-arm64" : "mac-x64";
  if (os === "linux") return "linux-appimage";
  return null;
}

function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} Mo`;
}

// ---------- Release lookup ----------

async function fetchLatestRelease(): Promise<Release | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(LATEST_API, { headers: { Accept: "application/vnd.github+json" }, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null; // 404: no release yet; 403: rate limited.
    const data = (await res.json()) as Release;
    return Array.isArray(data.assets) ? data : null;
  } catch {
    return null;
  }
}

function findAssets(release: Release | null): Partial<Record<AssetKey, ReleaseAsset>> {
  const found: Partial<Record<AssetKey, ReleaseAsset>> = {};
  if (!release) return found;
  for (const key of Object.keys(ASSET_PATTERNS) as AssetKey[]) {
    const asset = release.assets.find((a) => ASSET_PATTERNS[key].test(a.name));
    if (asset) found[key] = asset;
  }
  return found;
}

async function setupDownloads(): Promise<void> {
  const [{ os, arm }, release] = await Promise.all([detectOs(), fetchLatestRelease()]);
  const assets = findAssets(release);
  const version = release?.tag_name.replace(/^v/, "");

  // Every download link falls back to the releases page (already in the HTML).
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[data-asset]")) {
    const asset = assets[link.dataset.asset as AssetKey];
    if (asset) link.href = asset.browser_download_url;
    else link.href = release?.html_url ?? DOWNLOAD_FALLBACK;
  }

  if (version) {
    const heroVersion = document.getElementById("hero-version");
    if (heroVersion) heroVersion.textContent = `Version ${version} · Gratuit · Windows, macOS et Linux`;
    const downloadVersion = document.getElementById("download-version");
    if (downloadVersion) downloadVersion.textContent = `Version ${version}, pour Windows, macOS et Linux.`;
  }

  const primary = document.getElementById("dl-primary") as HTMLAnchorElement | null;
  const label = document.getElementById("dl-primary-label");
  const meta = document.getElementById("dl-primary-meta");
  if (!primary || !label || !meta) return;

  if (os === "windows" || os === "mac" || os === "linux") {
    document.querySelector(`.platform[data-os="${os}"]`)?.classList.add("current");
    for (const link of document.querySelectorAll<HTMLElement>("[data-os-link]")) {
      link.hidden = link.dataset.osLink === os;
    }
    const alt = document.getElementById("dl-alt");
    const others = (["windows", "mac", "linux"] as const).filter((o) => o !== os);
    if (alt) {
      alt.replaceChildren(
        "Aussi pour ",
        ...others.flatMap((o, i) => {
          const a = document.createElement("a");
          a.href = "#telecharger";
          a.textContent = OS_LABEL[o];
          return i === 0 ? [a, " et "] : [a];
        }),
      );
    }

    const key = primaryAssetKey(os, arm)!;
    const asset = assets[key];
    label.textContent = `Télécharger pour ${OS_LABEL[os]}`;
    if (asset) {
      primary.href = asset.browser_download_url;
      const detail = key === "mac-arm64" ? "Apple Silicon" : key === "mac-x64" ? "Intel" : key === "win-arm64" ? "ARM" : key === "linux-appimage" ? "AppImage" : "64 bits";
      meta.textContent = `Version ${version} · ${detail} · ${formatSize(asset.size)}`;
    } else {
      primary.href = release?.html_url ?? DOWNLOAD_FALLBACK;
      meta.textContent = release ? `Version ${version} sur GitHub` : "Téléchargements bientôt disponibles";
    }
  } else {
    // Phone, tablet or unknown system: point to the platform list instead of guessing.
    primary.href = DOWNLOAD_FALLBACK;
    label.textContent = "Choisir ma plateforme";
    meta.textContent = os === "mobile" ? "Pour ordinateur ; l'app mobile arrive bientôt" : "Windows, macOS ou Linux";
  }
}

void setupDownloads();
