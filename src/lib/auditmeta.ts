/**
 * Where a request came from, and how to say it in words a person can read.
 *
 * Kept apart from audit.ts, which is server-only, so the rules here can be
 * tested directly and reused by the screen that displays them.
 */

/** The actions written when somebody signs in, out, or fails to. */
export const AUTH_ACTIONS = {
  signedIn: "Signed in",
  signedOut: "Signed out",
  failed: "Sign-in failed",
  lockedOut: "Locked out",
} as const;

export type AuthAction = (typeof AUTH_ACTIONS)[keyof typeof AUTH_ACTIONS];

/** The entity name used for every authentication entry. */
export const SESSION_ENTITY = "Session";

/** An IPv6 address is at most 45 characters; nothing longer is an address. */
export const MAX_IP_LENGTH = 45;
/** User agents run long. Two hundred characters keeps every real one whole. */
export const MAX_AGENT_LENGTH = 200;
/** A typed email is attacker-supplied, so it is bounded before it is stored. */
export const MAX_TYPED_EMAIL_LENGTH = 120;

/** Anything that answers get(name) — a Headers object, or a plain map in a test. */
export type HeaderLike = { get(name: string): string | null | undefined };

/**
 * The caller's address, as far as it can honestly be known.
 *
 * `x-forwarded-for` is written by the client first and appended to by each
 * proxy, so its FIRST entry is whatever the caller chose to claim — an attacker
 * can put anything there. Railway's edge (Envoy) sets `x-envoy-external-address`
 * to the address it actually accepted the connection from, and appends that same
 * address to the end of the forwarded chain, so:
 *
 *   1. the address the proxy vouches for, if it gave us one;
 *   2. `x-real-ip`, which the proxy also writes;
 *   3. the LAST entry of `x-forwarded-for` — the nearest hop, not the claimed one.
 *
 * The first entry is deliberately never used. A forensic record that can be
 * dictated by the person being investigated is worse than no record: it does not
 * just fail to help, it points somewhere else.
 *
 * If another proxy is ever put in front of this one (a CDN, say), step 3 becomes
 * that proxy's address and this order needs revisiting.
 */
export function clientIp(h: HeaderLike): string | null {
  const direct = clean(h.get("x-envoy-external-address")) ?? clean(h.get("x-real-ip"));
  if (direct) return direct.slice(0, MAX_IP_LENGTH);

  const chain = clean(h.get("x-forwarded-for"));
  if (!chain) return null;
  const hops = chain.split(",").map((p) => p.trim()).filter(Boolean);
  const nearest = hops[hops.length - 1];
  return nearest ? nearest.slice(0, MAX_IP_LENGTH) : null;
}

/** The browser's self-description, bounded. */
export function clientAgent(h: HeaderLike): string | null {
  const ua = clean(h.get("user-agent"));
  return ua ? ua.slice(0, MAX_AGENT_LENGTH) : null;
}

function clean(v: string | null | undefined): string | null {
  if (!v) return null;
  // Header values cannot contain newlines, but a header read from somewhere
  // other than a real request might, and a log line that can be forged into two
  // log lines is not a log.
  const t = v.replace(/[\r\n\t]/g, " ").trim();
  return t.length ? t : null;
}

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bCriOS\//, "Chrome"],
  [/\bChrome\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

const PLATFORMS: [RegExp, string][] = [
  [/\bWindows NT\b/, "Windows"],
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bMac OS X\b|\bMacintosh\b/, "Mac"],
  [/\bCrOS\b/, "Chromebook"],
  [/\bLinux\b/, "Linux"],
];

/**
 * "Chrome on Windows" rather than ninety characters of version numbers.
 *
 * The full string is kept in the database — this is only what the screen shows,
 * because the person asking "was that me?" recognises a device, not a token.
 * Order matters below: Edge and Chrome both say "Chrome", and every one of them
 * says "Safari", so the more specific tests come first.
 */
export function shortAgent(ua: string | null | undefined): string {
  const s = clean(ua ?? null);
  if (!s) return "Unknown device";
  const browser = BROWSERS.find(([re]) => re.test(s))?.[1];
  const platform = PLATFORMS.find(([re]) => re.test(s))?.[1];
  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return platform;
  // Something that is not a browser — a script, a monitor, a phone app.
  return s.split(/[\s/]/)[0].slice(0, 40) || "Unknown device";
}

/** What to record as the user's name when the email matched no account. */
export function typedEmailLabel(email: string): string {
  const e = clean(email) ?? "";
  return e ? e.slice(0, MAX_TYPED_EMAIL_LENGTH) : "(no email given)";
}
