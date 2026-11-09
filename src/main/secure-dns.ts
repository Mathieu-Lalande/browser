import type { Settings } from "@shared/settings";
import { hostResolverConfig, sameResolverConfig, type HostResolverConfig } from "@shared/secure-dns";

export interface SecureDnsDeps {
  /** `app.configureHostResolver` (after `ready`): applies to every session of the app. */
  configure(config: HostResolverConfig): void;
  settings(): Settings;
  onSettingsChanged(listener: (current: Settings) => void): unknown;
}

/**
 * Secure DNS (DNS over HTTPS, ADR-046): Chromium's built-in resolver set from the settings at
 * startup, and again whenever the choice changes. App-wide: Chromium has one resolver for every
 * session (private windows included); the system's resolver still serves what Chromium does not
 * resolve itself, and an "automatic" choice falls back to plain DNS.
 */
export class SecureDnsService {
  private applied: HostResolverConfig | null = null;

  constructor(private readonly deps: SecureDnsDeps) {}

  start(): void {
    this.apply(this.deps.settings());
    this.deps.onSettingsChanged((current) => this.apply(current));
  }

  /** The configuration in force (null before `start`). */
  current(): HostResolverConfig | null {
    return this.applied;
  }

  private apply(settings: Settings): void {
    const next = hostResolverConfig(settings.privacy);
    if (this.applied && sameResolverConfig(this.applied, next)) return;
    try {
      this.deps.configure(next);
      this.applied = next;
    } catch (error) {
      console.warn("[dns] could not configure the resolver:", error);
    }
  }
}
