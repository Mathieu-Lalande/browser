import { describe, expect, it } from "vitest";
import { FALLBACK_FILENAME, fileExtension, isDangerousFile, sanitizeFilename, splitName, uniqueFilename } from "./files";

describe("isDangerousFile", () => {
  it.each([
    "setup.exe",
    "Installer.MSI",
    "run.bat",
    "run.cmd",
    "screensaver.scr",
    "payload.js",
    "macro.vbs",
    "script.ps1",
    "tool.jar",
    "Thing.app",
    "image.dmg",
    "package.pkg",
    "package.deb",
    "install.sh",
    "Tool-x86_64.AppImage",
    "shortcut.lnk",
    "page.hta",
  ])("flags %s", (name) => {
    expect(isDangerousFile(name)).toBe(true);
  });

  it.each(["report.pdf", "photo.jpeg", "archive.zip", "notes.txt", "data.json", "song.mp3", "README", ".bashrc", "setup.exe.txt"])(
    "lets %s through",
    (name) => {
      expect(isDangerousFile(name)).toBe(false);
    },
  );

  it("looks at the last extension only (double extensions are a classic trick)", () => {
    expect(isDangerousFile("invoice.pdf.exe")).toBe(true);
    expect(isDangerousFile("invoice.exe.pdf")).toBe(false);
  });

  it("ignores trailing dots and spaces, which Windows drops", () => {
    expect(isDangerousFile("setup.exe.")).toBe(true);
    expect(isDangerousFile("setup.exe .. ")).toBe(true);
    expect(fileExtension("archive.TAR.GZ")).toBe("gz");
    expect(fileExtension("noext")).toBe("");
  });
});

describe("sanitizeFilename", () => {
  it("keeps ordinary names", () => {
    expect(sanitizeFilename("Rapport annuel (final).pdf")).toBe("Rapport annuel (final).pdf");
    expect(sanitizeFilename("été.png")).toBe("été.png");
  });

  it("replaces separators, reserved and control characters", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("_.._etc_passwd");
    expect(sanitizeFilename("a\\b:c*d?e\"f<g>h|i.txt")).toBe("a_b_c_d_e_f_g_h_i.txt");
    expect(sanitizeFilename("bad\u0000name\n.txt")).toBe("bad_name_.txt");
  });

  it("never yields hidden files, trailing dots or empty names", () => {
    expect(sanitizeFilename(".htaccess")).toBe("htaccess");
    expect(sanitizeFilename("file.txt. . ")).toBe("file.txt");
    expect(sanitizeFilename("   ")).toBe(FALLBACK_FILENAME);
    expect(sanitizeFilename("...")).toBe(FALLBACK_FILENAME);
  });

  it("defuses Windows device names", () => {
    expect(sanitizeFilename("CON")).toBe("_CON");
    expect(sanitizeFilename("nul.txt")).toBe("_nul.txt");
    expect(sanitizeFilename("console.txt")).toBe("console.txt");
    // Whatever the case.
    expect(sanitizeFilename("Con.TXT")).toBe("_Con.TXT");
    expect(sanitizeFilename("lPt1")).toBe("_lPt1");
    expect(sanitizeFilename("cOm9.tar.gz")).toBe("_cOm9.tar.gz");
  });

  it("bounds the length but keeps the extension", () => {
    const name = sanitizeFilename(`${"x".repeat(500)}.pdf`);
    expect(name.length).toBe(200);
    expect(name.endsWith(".pdf")).toBe(true);
  });

  it("bounds the length even with a very long extension", () => {
    for (const name of [`a.${"x".repeat(500)}`, `${"b".repeat(300)}.${"y".repeat(300)}`, `c.${"z ".repeat(200)}`]) {
      const clean = sanitizeFilename(name);
      expect(clean.length).toBeLessThanOrEqual(200);
      expect(clean).not.toMatch(/[.\s]$/);
    }
    expect(sanitizeFilename(`a.${"x".repeat(500)}`).startsWith("a.")).toBe(true);
  });
});

describe("uniqueFilename", () => {
  const takenOf = (...names: string[]) => (name: string) => names.includes(name);

  it("keeps a free name", () => {
    expect(uniqueFilename("file.pdf", takenOf())).toBe("file.pdf");
  });

  it("numbers taken names before the extension", () => {
    expect(uniqueFilename("file.pdf", takenOf("file.pdf"))).toBe("file (1).pdf");
    expect(uniqueFilename("file.pdf", takenOf("file.pdf", "file (1).pdf", "file (2).pdf"))).toBe("file (3).pdf");
  });

  it("handles names without extension, dotfiles and compound extensions", () => {
    expect(uniqueFilename("README", takenOf("README"))).toBe("README (1)");
    expect(uniqueFilename("logs.tar.gz", takenOf("logs.tar.gz"))).toBe("logs (1).tar.gz");
    expect(splitName(".env")).toEqual({ base: ".env", ext: "" });
    expect(splitName("a.b.c")).toEqual({ base: "a.b", ext: ".c" });
  });

  it("gives up numbering after many attempts instead of looping forever", () => {
    const name = uniqueFilename("file.pdf", (candidate) => !/^file \(\d{10,}\)\.pdf$/.test(candidate));
    expect(name).toMatch(/^file \(\d{10,}\)\.pdf$/);
  });
});
