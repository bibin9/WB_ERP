import { randomInt } from "node:crypto";

/**
 * What makes a password acceptable, and how temporary ones are made.
 *
 * The rule was six characters on a change and nothing at all when an
 * administrator set one — "1" was accepted. And the temporary password handed
 * out on a reset came from Math.random, which is not built to be unguessable.
 *
 * Ten characters is the floor. Length is what makes a password hard to guess;
 * rules about mixing symbols mostly make people write passwords down. So on top
 * of the length it only refuses the handful of things people actually type
 * when asked for a password.
 *
 * Pure apart from the random source, so it is tested directly.
 */

export const MIN_PASSWORD_LENGTH = 10;

const COMMON = [
  "password", "passw0rd", "p@ssword", "welcome", "qwerty", "letmein", "admin", "abc123", "iloveyou",
  "123456", "1234567890", "whiteandbright", "wandb", "dubai", "sharjah", "uae", "changeme",
];

/** Why a password will not do, in words a person can act on — or null if it is fine. */
export function passwordProblem(password: string, context: { email?: string; name?: string } = {}): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. A short sentence you will remember is easiest — for example "Green tea at 7 on Friday".`;
  }
  if (password.length > 200) return "That is longer than any password needs to be — 200 characters at most.";
  const lower = password.toLowerCase();
  if (/^(.)\1+$/.test(password)) return "Do not use one character repeated. Try a short sentence instead.";
  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop)/.test(lower)) return "That is a keyboard or number run, which is the first thing anybody guesses.";
  const words = [context.email?.split("@")[0], ...(context.name?.split(/\s+/) ?? [])]
    .map((w) => (w ?? "").toLowerCase())
    .filter((w) => w.length >= 3);
  if (words.some((w) => lower.includes(w))) return "Do not put your own name or email in your password.";
  const stripped = lower.replace(/[^a-z0-9@]/g, "");
  if (COMMON.some((c) => stripped === c || stripped.startsWith(c) && stripped.slice(c.length).match(/^[0-9!@#$]*$/))) {
    return "That is one of the passwords attackers try first. Pick something only you would think of.";
  }
  return null;
}

/**
 * A temporary password: twelve characters from a cryptographic source, without
 * the ones that are misread when read aloud or copied from a screen (0/O, 1/l/I).
 */
export function temporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 12; i++) out += alphabet[randomInt(alphabet.length)];
  return `Wb-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}
