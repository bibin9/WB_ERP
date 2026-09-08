/**
 * Security headers.
 *
 * There were none. Each of these is a line of defence that costs a few hundred
 * bytes on the response and nothing at all in compute — they are instructions
 * to the browser, not work the server does.
 *
 * The one worth explaining is the Content-Security-Policy. A strict one needs a
 * per-request nonce threaded through the App Router, which is a bigger change
 * than this and easy to get subtly wrong; what is here is the part that can be
 * set safely today and still closes the doors that matter:
 *
 *   - `object-src 'none'` and `frame-ancestors 'none'` — no plugins, and the
 *     app cannot be framed, so it cannot be clickjacked;
 *   - `base-uri 'self'` — an injected <base> cannot repoint every relative URL;
 *   - `form-action 'self'` — a planted form cannot post credentials elsewhere;
 *   - `script-src` without `'unsafe-eval'` and with no external origins — an
 *     injected `<script src="//evil">` does not load.
 *
 * `'unsafe-inline'` stays for now because Next inlines its own bootstrap and
 * styles. It is the remaining gap, and the nonce work is the way to close it.
 * Uploaded files are served by their own route with a far stricter policy of
 * their own — see lib/uploads.ts.
 */

const isProd = process.env.NODE_ENV === "production";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (isProd ? "" : " 'unsafe-eval'"),
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

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  // The browser must not guess a content type. With the document route this is
  // what stops a file being reinterpreted as something executable.
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing here needs a camera, a microphone or a location.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

// HSTS only where TLS is actually terminated. Sending it from a local http dev
// server would pin the browser to https://localhost and break the next session.
if (isProd) {
  SECURITY_HEADERS.push({
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  });
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Version and framework are free reconnaissance for anybody scanning.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
