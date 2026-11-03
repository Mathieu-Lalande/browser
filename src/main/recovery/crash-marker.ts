import * as nodeFs from "node:fs";
import { join } from "node:path";

export type MarkerFs = Pick<typeof nodeFs, "existsSync" | "writeFileSync" | "rmSync" | "mkdirSync">;

/** Name of the marker file in the profile folder. */
export const RUNNING_MARKER = "running.marker";

/**
 * Unclean shutdown detection (ADR-042): a marker file is written when the profile opens and removed
 * on a clean quit, after every store is flushed. Finding it at the next start means the previous
 * run crashed, was killed, or the machine went down.
 */
export class CrashMarker {
  private readonly path: string;

  constructor(
    dir: string,
    private readonly fs: MarkerFs = nodeFs,
  ) {
    this.path = join(dir, RUNNING_MARKER);
  }

  /** Writes the marker; returns whether the previous run left one behind. */
  begin(pid = process.pid): boolean {
    let unclean = false;
    try {
      unclean = this.fs.existsSync(this.path);
      this.fs.mkdirSync(join(this.path, ".."), { recursive: true });
      this.fs.writeFileSync(this.path, String(pid));
    } catch (error) {
      console.warn("[recovery] marker:", error);
    }
    return unclean;
  }

  /** A clean quit: the marker goes. */
  end(): void {
    try {
      this.fs.rmSync(this.path, { force: true });
    } catch (error) {
      console.warn("[recovery] marker:", error);
    }
  }
}
