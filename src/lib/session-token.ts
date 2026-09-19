// Edge-safe session token helpers (no Prisma, no "server-only").
// Safe to import from middleware.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "wb_session";

/**
 * How long a sign-in lasts: a working day, not a week.
 *
 * Seven days meant a cookie copied off a shared or stolen machine kept working
 * for a week. Twelve hours covers a long shift; signing out now also ends the
 * session everywhere (lib/auth.ts), so this is the ceiling, not the only exit.
 */
export const SESSION_HOURS = 12;
export const SESSION_SECONDS = SESSION_HOURS * 60 * 60;

const FALLBACK = "dev-secret-change-me";

/**
 * The secret sessions are signed with — and stored mail passwords encrypted
 * with (lib/secrets.ts).
 *
 * It used to fall back to a value written in this file when AUTH_SECRET was
 * missing, on any server. Anyone who read the source could then sign a session
 * as anybody on a deployment where the variable had been forgotten. Now a
 * production server refuses to sign or check a session without a real secret;
 * the fallback is for development and tests only. `next build` does not sign
 * anything, so a build without the variable still completes.
 */
export function authSecret(): string {
  const value = process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    if (!value || value === FALLBACK) {
      throw new Error("AUTH_SECRET is not set. Set it to a long random value (for example: openssl rand -base64 48) in the service's variables.");
    }
    if (value.length < 32 && !warned) {
      warned = true;
      console.error("[security] AUTH_SECRET is shorter than 32 characters. Replace it with a long random value.");
    }
    return value;
  }
  return value || FALLBACK;
}
let warned = false;

let key: Uint8Array | null = null;
const secretKey = () => (key ??= new TextEncoder().encode(authSecret()));

export type SessionToken = {
  uid: string;
  tid: string;
  name: string;
  email: string;
  /** Seconds since the epoch, set by jose. Compared against the moment the
   *  password last changed and the last sign-out (lib/auth.ts). */
  iat?: number;
};

export async function signSession(payload: SessionToken): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secretKey());
}

export async function verifyToken(token: string): Promise<SessionToken | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return payload as unknown as SessionToken;
  } catch {
    return null;
  }
}
