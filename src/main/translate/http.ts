import type { HttpClient } from "@shared/translate/providers";

/**
 * The HTTP calls of translation (ADR-036), made by main only: Node's `fetch`, outside every
 * browsing session (no cookies, no cache, no extension, no page sees them), with a timeout, no
 * redirects (a key must not follow one) and a bounded answer.
 */

const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export const fetchHttp: HttpClient = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_RESPONSE_BYTES) throw new Error("response too large");
  return { status: response.status, body: new TextDecoder().decode(buffer) };
};
