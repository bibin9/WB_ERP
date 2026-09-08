// Edge-safe session token helpers (no Prisma, no "server-only").
// Safe to import from middleware.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "wb_session";
const secret = new TextEncoder().encode(process.env.AUTH_SECRET || "dev-secret-change-me");

export type SessionToken = {
  uid: string;
  tid: string;
  name: string;
  email: string;
  /** Seconds since the epoch, set by jose. Compared against the moment the
   *  password last changed, so resetting a password ends the sessions that
   *  were opened before it. */
  iat?: number;
};

export async function signSession(payload: SessionToken): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifyToken(token: string): Promise<SessionToken | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as SessionToken;
  } catch {
    return null;
  }
}
