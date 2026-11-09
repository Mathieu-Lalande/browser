import { ENERGY_OFF, energyPolicy, energyState, sameEnergyState, type EnergyPolicy, type EnergyState } from "@shared/energy";
import { Emitter } from "@shared/emitter";
import type { Settings } from "@shared/settings";
import type { WindowDirectory } from "./ports";

/** Electron's `powerMonitor`, injected (testable with a fake). */
export interface PowerPort {
  isOnBatteryPower(): boolean;
  on(event: "on-battery" | "on-ac", listener: () => void): unknown;
}

export interface EnergyDeps {
  power: PowerPort;
  settings(): Settings;
  onSettingsChanged(listener: (current: Settings) => void): unknown;
  windows: WindowDirectory;
}

/**
 * Energy saver (ADR-048): follows the setting and the power source, and tells the rest of the app.
 * The policy itself is pure (`@shared/energy`); consumers read `policy` when they act (tab sleeper,
 * thumbnails, media hub), the browser UIs get `state` in their window state (indicator, motion).
 */
export class EnergyService {
  private current: EnergyState = ENERGY_OFF;
  private readonly changes = new Emitter<EnergyState>();

  constructor(private readonly deps: EnergyDeps) {
    this.current = this.compute();
    deps.power.on("on-battery", () => this.update());
    deps.power.on("on-ac", () => this.update());
    deps.onSettingsChanged(() => this.update());
  }

  get state(): EnergyState {
    return this.current;
  }

  get policy(): EnergyPolicy {
    return energyPolicy(this.current);
  }

  onChanged(listener: (state: EnergyState) => void): () => void {
    return this.changes.on(listener);
  }

  /** Background throttling of every tab page, asserted while saving (Chromium's default, which pages may not keep). */
  throttle(contents: { setBackgroundThrottling(allowed: boolean): void; isDestroyed(): boolean }): void {
    if (this.policy.backgroundThrottling && !contents.isDestroyed()) contents.setBackgroundThrottling(true);
  }

  private compute(): EnergyState {
    let onBattery = false;
    try {
      onBattery = this.deps.power.isOnBatteryPower();
    } catch {
      // No power information (some Linux setups): treated as on AC.
    }
    return energyState(this.deps.settings().behavior.energySaver, onBattery);
  }

  private update(): void {
    const next = this.compute();
    if (sameEnergyState(next, this.current)) return;
    this.current = next;
    for (const window of this.deps.windows.all()) {
      for (const { manager, tab } of window.spaces.allTabs()) {
        const page = manager.pageOf(tab.id);
        if (page) this.throttle(page);
      }
    }
    this.changes.emit(next);
    this.deps.windows.refreshAll();
  }
}
