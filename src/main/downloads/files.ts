/** File name rules for downloads. Pure: no Electron, no fs (existence is a callback). */

/**
 * Extensions that run code when opened (executables, installers, scripts, shortcuts…) on at
 * least one desktop platform. Such downloads wait for an explicit confirmation.
 */
const DANGEROUS_EXTENSIONS = new Set([
  // Windows executables, installers, scripts and shortcuts.
  "exe", "com", "scr", "pif", "msi", "msp", "mst", "msix", "msixbundle", "appx", "appxbundle", "appref-ms",
  "bat", "cmd", "ps1", "psm1", "psd1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "cpl", "msc", "lnk",
  "url", "scf", "reg", "inf", "dll", "sys", "gadget", "application", "jar", "jnlp",
  // macOS.
  "app", "dmg", "pkg", "mpkg", "command", "tool", "workflow", "action", "terminal", "scpt", "osax",
  // Linux and Unix.
  "deb", "rpm", "sh", "bash", "zsh", "csh", "ksh", "run", "appimage", "flatpakref", "snap", "desktop",
  // Cross-platform runtimes and packages.
  "py", "pyw", "pl", "rb", "apk", "xpi", "crx",
]);

/**
 * The extension that decides how the OS treats the file, lowercase, without the dot. Windows
 * ignores trailing dots and spaces ("setup.exe. " is an .exe), so they are ignored here too.
 */
export function fileExtension(filename: string): string {
  const name = filename.replace(/[.\s]+$/, "");
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Whether opening the file could run code ("invoice.pdf.exe" is dangerous, "setup.exe.txt" is not). */
export function isDangerousFile(filename: string): boolean {
  return DANGEROUS_EXTENSIONS.has(fileExtension(filename));
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
const MAX_NAME_LENGTH = 200;
export const FALLBACK_FILENAME = "téléchargement";

/**
 * A file name safe on every OS: no path separators or reserved characters, no control
 * characters, no leading dots (hidden files) nor trailing dots/spaces, not a reserved device
 * name, and bounded in length (keeping the extension).
 */
export function sanitizeFilename(name: string): string {
  let clean = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_")
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "")
    .trim();
  if (WINDOWS_RESERVED.test(clean)) clean = `_${clean}`;
  if (clean.length > MAX_NAME_LENGTH) {
    const { base, ext } = splitName(clean);
    clean = base.slice(0, Math.max(1, MAX_NAME_LENGTH - ext.length)) + ext;
  }
  return clean || FALLBACK_FILENAME;
}

/** Multi-part extensions kept together when numbering ("logs (1).tar.gz", not "logs.tar (1).gz"). */
const COMPOUND = /\.tar\.(gz|bz2|xz|zst)$/i;

/** "report.pdf" → { base: "report", ext: ".pdf" }; dotfiles and extensionless names have no ext. */
export function splitName(name: string): { base: string; ext: string } {
  const compound = COMPOUND.exec(name);
  if (compound && compound.index > 0) return { base: name.slice(0, compound.index), ext: name.slice(compound.index) };
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { base: name.slice(0, dot), ext: name.slice(dot) } : { base: name, ext: "" };
}

/**
 * The first free name among "file.pdf", "file (1).pdf", "file (2).pdf"… `taken` says whether
 * a name is used (on disk, or reserved by another download in progress).
 */
export function uniqueFilename(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  const { base, ext } = splitName(name);
  for (let n = 1; n < 10_000; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!taken(candidate)) return candidate;
  }
  return `${base} (${Date.now()})${ext}`;
}
