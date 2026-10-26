import { randomUUID } from "node:crypto";
import { session, type Session } from "electron";
import { hardenSession, releaseSession } from "./security";

/**
 * Private windows' sessions (ADR-014). Each private window gets its own partition without the
 * `persist:` prefix, i.e. kept in memory by Chromium: cookies, storage, cache and HTTP auth never
 * reach the disk, and two private windows do not share them either. It is hardened like every
 * other session, with permission decisions and shields toggles kept to itself (`ephemeral`).
 */
const privateSessions = new WeakSet<Session>();

export function createPrivateSession(): Session {
  const ses = session.fromPartition(`private-${randomUUID()}`, { cache: true });
  privateSessions.add(ses);
  return hardenSession(ses, { ephemeral: true });
}

/**
 * Whether a session belongs to a private window. Profile writers that work per session rather than
 * per window must check it, e.g. downloads (`will-download` on the session): the file is saved where
 * the user asked, but no entry is added to the downloads history.
 */
export function isPrivateSession(ses: Session): boolean {
  return privateSessions.has(ses);
}

/** The window closed: everything its pages stored goes away now, not only when the app quits. */
export async function wipePrivateSession(ses: Session): Promise<void> {
  releaseSession(ses);
  await Promise.allSettled([ses.clearStorageData(), ses.clearCache(), ses.clearAuthCache(), ses.clearHostResolverCache()]);
}
