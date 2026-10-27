/** File name rules for downloads. Pure: no Electron, no fs (existence is a callback). */

import { fileExtension } from "@shared/downloads";

export { fileExtension };

/**
 * Extensions that run code, or open something that does, on at least one desktop platform:
 * Chromium's "dangerous" and "allow on user gesture" types (download_file_types.asciipb) plus a few
 * Unix ones. Such downloads wait for an explicit confirmation.
 */
const DANGEROUS_EXTENSIONS = new Set([
  // Windows executables, installers and packages.
  "exe", "com", "scr", "pif", "msi", "msp", "mst", "msix", "msixbundle", "appx", "appxbundle", "appinstaller",
  "appref-ms", "application", "xbap", "gadget", "cpl", "dll", "sys", "ocx", "drv", "diagcab", "msc", "xll",
  // Windows scripts and script hosts.
  "bat", "cmd", "ps1", "ps1xml", "ps2", "ps2xml", "psc1", "psc2", "psm1", "psd1", "msh", "msh1", "msh2", "mshxml",
  "msh1xml", "msh2xml", "vb", "vbs", "vbe", "js", "jse", "mjs", "ws", "wsf", "wsc", "wsh", "sct", "hta", "chm",
  // Windows shortcuts, settings and shell files that point at or run something else.
  "lnk", "url", "website", "scf", "shb", "shs", "reg", "inf", "settingcontent-ms", "library-ms", "search-ms",
  "searchconnector-ms", "theme", "themepack",
  // Disk images (mounted, then their content auto-runs or is trusted).
  "iso", "img", "vhd", "vhdx", "udf",
  // Office documents with macros, add-ins.
  "docm", "dotm", "xlsm", "xltm", "xlam", "pptm", "potm", "ppam", "ppsm", "sldm",
  // Documents a browser or a viewer opens with local file rights.
  "html", "htm", "xht", "xhtml", "shtml", "svg", "mht", "mhtml",
  // Java.
  "jar", "jnlp",
  // macOS.
  "app", "dmg", "pkg", "mpkg", "command", "tool", "workflow", "action", "terminal", "scpt", "osax", "kext",
  "prefpane", "webloc", "fileloc", "inetloc", "mobileconfig", "dylib", "bundle", "plugin", "saver",
  // Linux and Unix.
  "deb", "rpm", "sh", "bash", "zsh", "csh", "ksh", "run", "appimage", "flatpakref", "snap", "desktop",
  // Cross-platform runtimes and packages.
  "py", "pyw", "pyc", "pl", "rb", "php", "apk", "xpi", "crx",
]);

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
    // Invisible format characters (bidi overrides that make "fdp.exe" read "exe.pdf", zero-width
    // spaces, BOM…) are dropped, not replaced: they must not change what the name says.
    .replace(/\p{Cf}/gu, "")
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
