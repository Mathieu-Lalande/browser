import { NativeModule, requireOptionalNativeModule } from "expo";

/** Blocked requests since the last batch (Android): page host, blocked host, how many. */
export interface BlockedEvent {
  page: string;
  tracker: string;
  count: number;
}

type ContentBlockerEvents = {
  onBlocked(payload: { events: BlockedEvent[] }): void;
};

declare class ContentBlockerModule extends NativeModule<ContentBlockerEvents> {
  /** Whether blocked requests are reported (`onBlocked`): Android only, WebKit gives no callback. */
  readonly counts: boolean;
  /**
   * Turns blocking on or off, with the sites where the shield is off (registrable domains,
   * lowercase). Resolves with the number of compiled lists (iOS) or rules (Android).
   */
  apply(enabled: boolean, allowlist: string[]): Promise<number>;
}

/**
 * The native content blocker (ADR-051), or null where it does not exist: Expo Go and the web,
 * which keep the cosmetic filtering done in JavaScript.
 */
export const ContentBlocker = requireOptionalNativeModule<ContentBlockerModule>("ContentBlocker");
