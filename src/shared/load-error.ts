/**
 * Page load failures (Chromium net error codes, `did-fail-load`) grouped into families the
 * built-in error page explains in plain French. Pure: shared by main and the chrome UI.
 */

/** A main-frame load that failed; the tab shows the error page instead of its (blank) view. */
export interface LoadError {
  /** Chromium net error code (negative), e.g. -105 for ERR_NAME_NOT_RESOLVED. */
  code: number;
  /** Chromium's description, e.g. "ERR_NAME_NOT_RESOLVED". */
  description: string;
  url: string;
}

export type LoadErrorFamily = "dns" | "offline" | "refused" | "reset" | "timeout" | "certificate" | "redirects" | "unreachable" | "blocked" | "other";

export interface LoadErrorText {
  family: LoadErrorFamily;
  title: string;
  /** One sentence; `{host}` is replaced by the site's host. */
  message: string;
  /** What the user can try. */
  advice: string;
}

const TEXTS: Record<LoadErrorFamily, Omit<LoadErrorText, "family">> = {
  dns: {
    title: "Site introuvable",
    message: "L'adresse de {host} n'a pas pu être trouvée.",
    advice: "Vérifiez l'orthographe de l'adresse, ou réessayez dans un instant.",
  },
  offline: {
    title: "Pas de connexion Internet",
    message: "L'appareil n'est connecté à aucun réseau.",
    advice: "Vérifiez le Wi-Fi ou le câble réseau, puis actualisez la page.",
  },
  refused: {
    title: "Connexion refusée",
    message: "{host} a refusé la connexion.",
    advice: "Le site est peut-être arrêté, ou n'accepte pas les connexions sur cette adresse.",
  },
  reset: {
    title: "Connexion interrompue",
    message: "La connexion à {host} a été coupée avant la fin du chargement.",
    advice: "Actualisez la page. Si le problème persiste, un pare-feu ou un proxy bloque peut-être le site.",
  },
  timeout: {
    title: "Le site met trop de temps à répondre",
    message: "{host} n'a pas répondu à temps.",
    advice: "Le site est peut-être surchargé. Réessayez dans un instant.",
  },
  certificate: {
    title: "Connexion non sécurisée",
    message: "Le certificat de {host} n'est pas valide : la connexion a été bloquée pour vous protéger.",
    advice: "Quelqu'un tente peut-être d'intercepter vos données. Réessayez plus tard ou depuis un autre réseau.",
  },
  redirects: {
    title: "Trop de redirections",
    message: "{host} redirige en boucle.",
    advice: "Effacer les cookies du site résout souvent le problème.",
  },
  unreachable: {
    title: "Site inaccessible",
    message: "Impossible de joindre {host}.",
    advice: "Vérifiez votre connexion, ou réessayez dans un instant.",
  },
  blocked: {
    title: "Adresse bloquée",
    message: "Le navigateur n'ouvre pas {host} : ce port ou cette adresse est bloqué pour votre sécurité.",
    advice: "Vérifiez l'adresse. Les ports réservés à d'autres services (messagerie, partage de fichiers…) ne sont jamais ouverts.",
  },
  other: {
    title: "Impossible d'afficher la page",
    message: "Le chargement de {host} a échoué.",
    advice: "Actualisez la page, ou réessayez plus tard.",
  },
};

/** The family of a Chromium net error code. */
export function loadErrorFamily(code: number): LoadErrorFamily {
  if (code === -105 || code === -137) return "dns"; // NAME_NOT_RESOLVED, NAME_RESOLUTION_FAILED
  if (code === -106 || code === -21) return "offline"; // INTERNET_DISCONNECTED, NETWORK_CHANGED
  if (code === -102) return "refused"; // CONNECTION_REFUSED
  if (code === -100 || code === -101 || code === -324 || code === -103) return "reset"; // CLOSED, RESET, EMPTY_RESPONSE, ABORTED
  if (code === -7 || code === -118) return "timeout"; // TIMED_OUT, CONNECTION_TIMED_OUT
  if (code <= -200 && code > -300) return "certificate"; // CERT_* range
  if (code === -107 || code === -113 || code === -117) return "certificate"; // SSL_PROTOCOL_ERROR, SSL_VERSION_OR_CIPHER_MISMATCH, BAD_SSL_CLIENT_AUTH_CERT
  if (code === -310) return "redirects"; // TOO_MANY_REDIRECTS
  if (code === -104 || code === -109 || code === -108) return "unreachable"; // CONNECTION_FAILED, ADDRESS_UNREACHABLE, ADDRESS_INVALID
  if (code === -312 || code === -20 || code === -301) return "blocked"; // UNSAFE_PORT, BLOCKED_BY_CLIENT, DISALLOWED_URL_SCHEME
  return "other";
}

/** What the error page says for `error`. */
export function describeLoadError(error: LoadError): LoadErrorText {
  const family = loadErrorFamily(error.code);
  let host = error.url;
  try {
    host = new URL(error.url).host || error.url;
  } catch {
    // Not a URL: shown as is.
  }
  const text = TEXTS[family];
  return { family, ...text, message: text.message.replace("{host}", host || "ce site") };
}
