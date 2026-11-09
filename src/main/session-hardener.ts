import type { Session } from "electron";
import type { Settings } from "@shared/settings";
import { acceptLanguages, normalizesLanguages, reduceUserAgent } from "./fingerprint";
import type { SessionOptions, SessionService } from "./services";

/** What SessionHardener needs from the app. */
export interface HardenerDeps {
  /** Installed into each tab session, in this order (privacy first: it guards the others' traffic). */
  readonly services: readonly SessionService[];
  appName(): string;
  locale(): string;
  settings(): Settings;
  onSettingsChanged(listener: (current: Settings) => void): unknown;
}

/**
 * Hardening of the sessions tabs can use (ADR-014): every session service installed once per
 * session, and a desktop-Chrome-like identity (user agent, `Accept-Language`) that follows the
 * "normalize languages" setting.
 */
export class SessionHardener {
  /** Hardened sessions → their reduced user agent (re-applied with new languages when settings change). */
  private readonly hardened = new Map<Session, string>();
  private languagesFollowSettings = false;

  constructor(private readonly deps: HardenerDeps) {}

  /** Idempotent (once per session). */
  harden(ses: Session, options: SessionOptions = {}): Session {
    if (this.hardened.has(ses)) return ses;
    for (const service of this.deps.services) service.install(ses, options);
    // A desktop-Chrome-like user agent: the default one advertises Electron and the app name,
    // which both breaks sites and makes users easier to fingerprint (ADR-014).
    const userAgent = reduceUserAgent(ses.getUserAgent(), this.deps.appName());
    this.hardened.set(ses, userAgent);
    this.applyIdentity(ses, userAgent);
    this.followLanguages();
    return ses;
  }

  isHardened(ses: Session): boolean {
    return this.hardened.has(ses);
  }

  /** Forgets a session that is going away (a private window closed). */
  release(ses: Session): void {
    this.hardened.delete(ses);
    for (const service of this.deps.services) service.release?.(ses);
  }

  /** User agent and `Accept-Language` of a session, following the "normalize languages" setting. */
  private applyIdentity(ses: Session, userAgent: string): void {
    ses.setUserAgent(userAgent, acceptLanguages(normalizesLanguages(this.deps.settings().privacy), this.deps.locale()));
  }

  private followLanguages(): void {
    if (this.languagesFollowSettings) return;
    this.languagesFollowSettings = true;
    let normalize = normalizesLanguages(this.deps.settings().privacy);
    this.deps.onSettingsChanged((current) => {
      if (normalizesLanguages(current.privacy) === normalize) return;
      normalize = normalizesLanguages(current.privacy);
      for (const [known, agent] of this.hardened) this.applyIdentity(known, agent);
    });
  }
}
