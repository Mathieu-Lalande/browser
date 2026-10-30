import type { UpdateEvent } from "@shared/updates";
import type { Updater } from "./service";

/**
 * Scripted updater for development and e2e tests (`BROWSER_TEST_UPDATER`, honored only by an
 * unpackaged app, ADR-018): never touches the network.
 * - "available": a new version, downloaded in a few progress steps;
 * - "none": already up to date;
 * - "error": every check fails;
 * - "manual": a new version this installation cannot install (macOS without a signature).
 */
export type FakeScenario = "available" | "none" | "error" | "manual";

export const isFakeScenario = (value: unknown): value is FakeScenario =>
  value === "available" || value === "none" || value === "error" || value === "manual";

export const FAKE_VERSION = "99.0.0";

export class FakeUpdater implements Updater {
  private listener: (event: UpdateEvent) => void = () => {};
  installs = 0;

  constructor(
    private readonly scenario: FakeScenario,
    private readonly stepMs = 150,
  ) {}

  configure(): void {}

  onEvent(listener: (event: UpdateEvent) => void): void {
    this.listener = listener;
  }

  private wait(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.stepMs));
  }

  async check(): Promise<void> {
    this.listener({ type: "checking" });
    await this.wait();
    if (this.scenario === "error") throw new Error("fake check failure");
    this.listener(this.scenario === "none" ? { type: "not-available" } : { type: "available", version: FAKE_VERSION });
  }

  async download(): Promise<void> {
    for (const percent of [10, 45, 80]) {
      this.listener({ type: "progress", percent });
      await this.wait();
    }
    this.listener({ type: "downloaded", version: FAKE_VERSION });
  }

  install(): void {
    this.installs++;
  }
}
