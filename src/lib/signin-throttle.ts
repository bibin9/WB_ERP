import { db } from "./db";

/**
 * How many wrong passwords, from where, before sign-in pauses.
 *
 * The old lock-out had two faults, both found in the September security review:
 *
 *  - It read the failure count, checked the password, then wrote count + 1.
 *    Guesses sent at the same instant all read "0 failed", so an attacker got
 *    as many tries as they could send at once, not three.
 *  - It locked the account itself after three failures from anyone. A stranger
 *    who knew the Group Admin's email could keep them out indefinitely, three
 *    guesses every fifteen minutes, and flood every administrator with alerts.
 *
 * Now every attempt is counted BEFORE the password is checked, by an atomic
 * increment in the database, and only attempts that land within the limit get
 * a password check at all — however many arrive together. A correct password
 * hands its count back, so only failures accumulate.
 *
 * And the count is kept three ways:
 *
 *   this address, this account      3 in 15 minutes   — what a person mistyping sees
 *   this address, any account      20 in 15 minutes   — one machine spraying emails
 *   this account, any address      10 in 15 minutes   — many machines on one account
 *
 * So a stranger's guesses pause the stranger. Only a spread attack from many
 * addresses at once can pause the account for everybody, and that is when the
 * administrators are told.
 */

/**
 * One answer for every wrong attempt.
 *
 * The screen used to say "2 attempts left" for a real account and something
 * else for an address nobody had, and "deactivated" or "locked" to anyone who
 * asked — so it could be used to find out which staff emails exist. Now the
 * reply is the same whatever the reason until the password is right; only then
 * is a deactivated or locked account told so, and only to the person who knows
 * its password.
 */
export const WRONG = "That email and password do not match. Check for typing mistakes — after 3 wrong tries, sign-in pauses for 15 minutes.";
export const PAUSED = "Too many wrong tries, so sign-in is paused for 15 minutes. If you have forgotten your password, ask your administrator to reset it.";

export const WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;
export const LIMITS = { pair: 3, address: 20, account: 10 } as const;

export type ThrottleKeys = { pair: string; address: string; account: string };

/** The three counters one attempt touches. `who` is the user id, or the typed email if there is no such user. */
export function keysFor(who: string, ip: string | null): ThrottleKeys {
  const from = ip || "unknown";
  return { pair: `pair:${who}:${from}`, address: `ip:${from}`, account: `acct:${who}` };
}

type Count = { key: string; allowed: boolean; justLocked: boolean };

/** Count one attempt against one key, atomically. */
async function count(key: string, limit: number, now: Date): Promise<Count> {
  // A window that has run out, and is not still serving a pause, starts again.
  await db.signInThrottle.updateMany({
    where: {
      key,
      windowStart: { lt: new Date(now.getTime() - WINDOW_MS) },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    data: { failures: 0, windowStart: now, lockedUntil: null },
  });

  let row;
  try {
    row = await db.signInThrottle.upsert({
      where: { key },
      create: { key, failures: 1, windowStart: now },
      update: { failures: { increment: 1 } },
    });
  } catch {
    // Two first attempts at once: one created the row, so the other increments.
    row = await db.signInThrottle.update({ where: { key }, data: { failures: { increment: 1 } } });
  }

  if (row.lockedUntil && row.lockedUntil > now) return { key, allowed: false, justLocked: false };
  if (row.failures <= limit) return { key, allowed: true, justLocked: false };

  // Over the limit: start the pause, once. Only the attempt that starts it is
  // told so, which is what keeps the administrators' alert to one.
  const started = await db.signInThrottle.updateMany({
    where: { key, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + LOCK_MS) },
  });
  return { key, allowed: false, justLocked: started.count === 1 };
}

export type Reservation = {
  /** Whether this attempt may have its password checked. */
  allowed: boolean;
  /** This attempt started a pause on the whole account (all addresses). */
  accountLocked: boolean;
  keys: ThrottleKeys;
};

/**
 * Count an attempt. Call before checking the password.
 *
 * In order, stopping at the first refusal: the address, then this address on
 * this account, and only then the account as a whole. Counting all three at
 * once let thirty simultaneous guesses from one machine — refused by its own
 * limit — still pile onto the account and pause it for everybody, which is
 * the lock-out problem this exists to solve. This way one machine adds at
 * most three to an account's count, and pausing an account for everyone takes
 * guesses from several places.
 */
export async function reserveAttempt(keys: ThrottleKeys, now = new Date()): Promise<Reservation> {
  const refused = { allowed: false, accountLocked: false, keys };
  if (!(await count(keys.address, LIMITS.address, now)).allowed) return refused;
  if (!(await count(keys.pair, LIMITS.pair, now)).allowed) return refused;
  const account = await count(keys.account, LIMITS.account, now);
  return { allowed: account.allowed, accountLocked: account.justLocked, keys };
}

/** The password was right: give this attempt back, so only failures count. */
export async function releaseAttempt(keys: ThrottleKeys): Promise<void> {
  await db.signInThrottle.updateMany({
    where: { key: { in: [keys.pair, keys.address, keys.account] }, failures: { gt: 0 } },
    data: { failures: { decrement: 1 } },
  });
  // A person who has just proved who they are is not left paused on this machine.
  await db.signInThrottle.updateMany({ where: { key: keys.pair }, data: { failures: 0, lockedUntil: null } });
}

/** An administrator unlocked the account: clear every pause that names it. */
export async function clearAccount(userId: string): Promise<void> {
  await db.signInThrottle.deleteMany({
    where: { OR: [{ key: `acct:${userId}` }, { key: { startsWith: `pair:${userId}:` } }] },
  });
}

/** Rows nobody has touched for a day are history, not protection. */
export async function sweep(now = new Date()): Promise<void> {
  await db.signInThrottle.deleteMany({
    where: {
      windowStart: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
  });
}
