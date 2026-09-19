// Edge-safe: used by middleware on every page request.

/**
 * The Content-Security-Policy, with a fresh nonce for every page.
 *
 * Until September 2026 the policy allowed 'unsafe-inline' scripts, because
 * Next inlines its own bootstrap and a static header cannot know a nonce. That
 * was the one gap the header left open: any script that ever got into a page
 * would run. Now middleware makes a random nonce per request, sends it in this
 * header and hands it to Next, which puts it on every script it renders; the
 * theme script in the root layout reads it too. A script without that nonce —
 * anything injected — does not run.
 *
 * 'strict-dynamic' lets the scripts that carry the nonce load Next's own
 * chunks, so no origin list is needed. Styles keep 'unsafe-inline': React
 * style attributes need it, and a style cannot run code.
 */
export function contentSecurityPolicy(nonce: string, isProd: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'` + (isProd ? "" : " 'unsafe-eval'"),
    "style-src 'self' 'unsafe-inline'",
    // Company letterheads are stored as data: URIs, so images need it.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isProd ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** A nonce: 128 random bits, base64. Works in the edge runtime. */
export function makeNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
