import type { Certificate, Session } from "electron";
import type { CertificateInfo } from "@shared/site-info";

/**
 * Certificates of the hosts a session connected to, for the site info popover (ADR-021).
 *
 * Electron gives pages' certificates to main in two places only: `certificate-error` (failures) and
 * `session.setCertificateVerifyProc`, called for each verification Chromium makes in the session.
 * The proc answers `-3` ("use Chromium's own verdict"): it never changes what is trusted, it only
 * records the certificate of each host verified successfully. Kept in memory, per session (a
 * private window's go with it), at most `MAX_HOSTS` per session.
 */
const MAX_HOSTS = 500;
const known = new WeakMap<Session, Map<string, CertificateInfo>>();

/** Electron's certificate → what the popover shows. */
export function certificateInfo(certificate: Certificate): CertificateInfo {
  return {
    subject: certificate.subject?.commonName || certificate.subjectName,
    issuer: certificate.issuer?.commonName || certificate.issuerName,
    validFrom: certificate.validStart * 1000,
    validTo: certificate.validExpiry * 1000,
    fingerprint: certificate.fingerprint,
  };
}

/** Starts recording the certificates verified in `ses`. Idempotent. */
export function trackCertificates(ses: Session): void {
  if (known.has(ses)) return;
  const hosts = new Map<string, CertificateInfo>();
  known.set(ses, hosts);
  ses.setCertificateVerifyProc((request, callback) => {
    if (request.errorCode === 0) {
      const host = request.hostname.toLowerCase();
      hosts.delete(host);
      hosts.set(host, certificateInfo(request.certificate));
      // Oldest first: a Map keeps insertion order.
      if (hosts.size > MAX_HOSTS) hosts.delete(hosts.keys().next().value!);
    }
    callback(-3);
  });
}

/** The certificate last verified for `host` in `ses`, if any. */
export function certificateFor(ses: Session, host: string): CertificateInfo | null {
  return known.get(ses)?.get(host.toLowerCase()) ?? null;
}
