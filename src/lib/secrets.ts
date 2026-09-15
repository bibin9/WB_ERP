import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Encrypting the few things that must be stored but must not be readable.
 *
 * A mail password is the case this exists for. It cannot be hashed the way a
 * user's password is, because the system has to present the real thing to the
 * mail server every time it sends. So it is encrypted, and the difference
 * matters: hashing protects a secret nobody needs back, encryption protects
 * one that has to be used.
 *
 * What this is and is not
 * -----------------------
 * The key is derived from AUTH_SECRET, which means anybody holding both the
 * database AND the environment can read these values. That is a deliberate
 * limit, not an oversight: a system that has to send mail unattended must be
 * able to get the password back unattended, and any scheme where it can do
 * that is a scheme where somebody with the whole server can too.
 *
 * What it does stop is the case that actually happens — a database dump, a
 * backup file, a support export, a screen-share of a table viewer. Those carry
 * the rows and not the environment, and in all of them the password is noise.
 *
 * AES-256-GCM, so a tampered value fails to decrypt rather than decrypting to
 * something else.
 */

const VERSION = "v1";

/**
 * The key, derived once per process.
 *
 * A fixed salt because the same key has to come back on every boot and every
 * instance; the secrecy lives in AUTH_SECRET, not in the salt. scrypt rather
 * than a bare hash so that a weak AUTH_SECRET still costs something to attack.
 */
let cached: Buffer | null = null;
function key(): Buffer {
  if (cached) return cached;
  const secret = process.env.AUTH_SECRET || "dev-secret-change-me";
  cached = scryptSync(secret, "wb-erp-secret-box", 32);
  return cached;
}

/**
 * Encrypt a value for storage.
 *
 * The result carries its version, its nonce and its tag, so the format can be
 * changed later without having to guess how old rows were written.
 */
export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), body.toString("base64")].join(":");
}

/**
 * Read a stored value back.
 *
 * Returns null rather than throwing on anything it cannot read — a changed
 * AUTH_SECRET, a truncated column, a value written by a future version. The
 * caller's job is then to say "the password needs entering again", which is
 * true and actionable, rather than to crash on a settings screen.
 */
export function unseal(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const parts = String(sealed).split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;

  try {
    const [, iv, tag, body] = parts;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const out = Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]);
    return out.toString("utf8");
  } catch {
    return null;
  }
}

/** Whether a stored value can still be read with the current key. */
export const isReadable = (sealed: string | null | undefined): boolean => unseal(sealed) !== null;

/**
 * Compare two secrets without leaking which character differed.
 *
 * Not needed for the mail password, but it is the kind of thing that gets
 * added later with `===` by somebody in a hurry, so it is here already.
 */
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}
