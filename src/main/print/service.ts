import { t } from "@shared/i18n";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { WebContentsView, dialog, session, type BaseWindow, type WebContents } from "electron";
import {
  DEFAULT_PRINT_OPTIONS,
  PDF_DESTINATION,
  pdfOptions,
  printLayout,
  printerOptions,
  type PrintOptions,
  type PrintPrinter,
  type PrintResult,
} from "@shared/print";
import type { OverlayKind, OverlayRequest, TabId } from "@shared/types";

/** What the preview needs from its window (a BrowserController). */
export interface PrintHost {
  readonly window: BaseWindow;
  readonly isPrivate: boolean;
  readonly overlay: { open(request: OverlayRequest): void; close(restoreFocus?: boolean): void; readonly shown: OverlayKind | null; setTopView(view: WebContentsView | null): void };
}

export interface PrintDeps {
  /** Where "Enregistrer en PDF" proposes to save. */
  downloadsFolder(): string;
  /** Test hook (unpackaged only): PDFs are written there without a save dialog. */
  testSavePath?: string;
}

/** The in-memory session of the preview pages: only local PDFs, nothing kept. */
const PREVIEW_PARTITION = "print-preview";

/** One open preview: the page printed and the PDF view above the overlay layer. */
class Preview {
  readonly view: WebContentsView;
  options: PrintOptions = { ...DEFAULT_PRINT_OPTIONS };
  pdf: Buffer | null = null;
  private generation = 0;

  constructor(
    readonly host: PrintHost,
    readonly page: WebContents,
    readonly title: string,
    private readonly file: string,
  ) {
    this.view = new WebContentsView({
      webPreferences: {
        session: session.fromPartition(PREVIEW_PARTITION),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Chromium's PDF viewer is the only "plugin" (ADR-039).
        plugins: true,
      },
    });
    this.view.setBackgroundColor("#525659");
    const contents = this.view.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event) => event.preventDefault());
  }

  /** Prints the page to PDF with the current options and shows it. */
  async render(): Promise<PrintResult> {
    const generation = ++this.generation;
    try {
      const pdf = await this.page.printToPDF(pdfOptions(this.options));
      if (generation !== this.generation || this.view.webContents.isDestroyed()) return { ok: true };
      this.pdf = pdf;
      writeFileSync(this.file, pdf);
      // A new query string: the viewer reloads the new file.
      await this.view.webContents.loadURL(`${pathToFileURL(this.file).href}?v=${generation}#toolbar=0&view=FitH`).catch(() => undefined);
      return { ok: true };
    } catch (error) {
      console.warn("[print] preview:", error);
      return { ok: false, message: t("printService.previewCouldntGeneratedCheck") };
    }
  }

  layout(): void {
    if (this.host.window.isDestroyed()) return;
    const { width, height } = this.host.window.getContentBounds();
    this.view.setBounds(printLayout(width, height).preview);
  }

  destroy(): void {
    const window = this.host.window;
    if (!window.isDestroyed() && window.contentView.children.includes(this.view)) window.contentView.removeChildView(this.view);
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
    rmSync(this.file, { force: true });
  }
}

/**
 * Print preview and PDF (ADR-042): "Imprimer…" renders the page with `printToPDF` into a temporary
 * file shown by Chromium's PDF viewer in a native view above the overlay layer, which draws the
 * options (pages, orientation, margins, scale, background graphics, destination). "Enregistrer"
 * writes the PDF where the user chooses; a printer prints with `webContents.print`.
 */
export class PrintService {
  private readonly previews = new Map<PrintHost, Preview>();
  private tempDir: string | null = null;

  constructor(private readonly deps: PrintDeps) {}

  async open(host: PrintHost, page: WebContents, title: string, tabId: TabId): Promise<void> {
    this.close(host);
    const dir = (this.tempDir ??= mkdtempSync(join(tmpdir(), "browser-print-")));
    const preview = new Preview(host, page, title, join(dir, `preview-${Date.now()}-${tabId.slice(0, 8)}.pdf`));
    // The overlay first: opening it dismisses any previous floating UI (and preview).
    host.overlay.open({ kind: "print-preview", tabId, print: { title, layout: this.layoutOf(host) } });
    this.previews.set(host, preview);
    host.window.contentView.addChildView(preview.view);
    host.overlay.setTopView(preview.view);
    preview.layout();
    const onResize = () => preview.layout();
    host.window.on("resize", onResize);
    preview.view.webContents.once("destroyed", () => {
      if (!host.window.isDestroyed()) host.window.off("resize", onResize);
    });
    await preview.render();
  }

  private layoutOf(host: PrintHost) {
    const { width, height } = host.window.getContentBounds();
    return printLayout(width, height);
  }

  /** The options changed: the preview is rendered again. */
  async update(host: PrintHost, options: PrintOptions): Promise<PrintResult> {
    const preview = this.previews.get(host);
    if (!preview) return { ok: false, message: t("printService.previewClosed") };
    const reRender = options.orientation !== preview.options.orientation || options.margins !== preview.options.margins ||
      options.scale !== preview.options.scale || options.background !== preview.options.background || options.pages !== preview.options.pages;
    preview.options = options;
    return reRender ? preview.render() : { ok: true };
  }

  async printers(host: PrintHost): Promise<PrintPrinter[]> {
    const preview = this.previews.get(host);
    if (!preview || preview.page.isDestroyed()) return [];
    const list = await preview.page.getPrintersAsync().catch(() => []);
    return list.map((printer) => ({ name: printer.name, displayName: printer.displayName || printer.name, isDefault: !!(printer as { isDefault?: boolean }).isDefault }));
  }

  /** "Enregistrer" (PDF) or "Imprimer" (printer), with the options shown; closes the preview when done. */
  async run(host: PrintHost, options: PrintOptions): Promise<PrintResult> {
    const preview = this.previews.get(host);
    if (!preview || preview.page.isDestroyed()) return { ok: false, message: t("printService.pageNoLongerOpen") };
    await this.update(host, options);
    if (options.destination === PDF_DESTINATION) {
      const pdf = preview.pdf ?? (await preview.page.printToPDF(pdfOptions(options)));
      const path = await this.savePath(host, preview.title);
      if (!path) return { ok: false, message: "" };
      try {
        writeFileSync(path, pdf);
      } catch {
        return { ok: false, message: t("printService.fileCouldntWritten") };
      }
    } else {
      const page = preview.page;
      const printed = await new Promise<boolean>((resolve) => page.print(printerOptions(options), (success) => resolve(success)));
      if (!printed) return { ok: false, message: t("printService.printingFailed") };
    }
    this.closeOverlay(host);
    return { ok: true };
  }

  private async savePath(host: PrintHost, title: string): Promise<string | null> {
    if (this.deps.testSavePath) return this.deps.testSavePath;
    const base = (title || "page").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 120) || "page";
    const { canceled, filePath } = await dialog.showSaveDialog(host.window, {
      title: t("printService.savePdf"),
      defaultPath: join(this.deps.downloadsFolder(), `${base}.pdf`),
      filters: [{ name: t("printService.pdfDocument"), extensions: ["pdf"] }],
    });
    return canceled || !filePath ? null : filePath;
  }

  /** "Annuler". */
  closeOverlay(host: PrintHost): void {
    if (host.overlay.shown === "print-preview") host.overlay.close(true);
    this.close(host);
  }

  /** The overlay closed or shows something else: the preview goes. */
  close(host: PrintHost): void {
    const preview = this.previews.get(host);
    if (!preview) return;
    this.previews.delete(host);
    host.overlay.setTopView(null);
    preview.destroy();
  }

  dispose(): void {
    if (this.tempDir) rmSync(this.tempDir, { recursive: true, force: true });
  }
}
