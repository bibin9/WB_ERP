import type { Prisma } from "@prisma/client";
import { db } from "./db";

/**
 * One at a time, for the few things that must never interleave.
 *
 * A stress test against PostgreSQL found two places where the system checked a
 * figure and then acted on it, with nothing to stop a second person checking
 * the same figure in between:
 *
 *   - Twenty-five people issuing one each from a shelf of ten: twenty-four got
 *     through and the stock went to minus fourteen. Every issue read "ten on
 *     the shelf" before any of them had saved.
 *   - Ten deliveries of five against an order line for ten, recorded at once:
 *     all ten were accepted, and fifty arrived against an order for ten.
 *
 * And a third where it did not corrupt anything but refused most of the work:
 * twenty-five purchase orders raised at once collided on the next number, and
 * twenty were turned away after five tries.
 *
 * `serialised` runs a short piece of work while holding a lock named by its
 * keys. On PostgreSQL the lock is a transaction-scoped advisory lock, so it
 * holds across every server process and is released when the transaction ends,
 * however it ends. The work is given the transaction's client and must do its
 * reads and writes through it — that is what makes the check and the write one
 * step. On SQLite, used for local development, there are no advisory locks and
 * one process, so the same keys queue in memory instead.
 *
 * Keep the work short: waiting callers each hold a database connection. Post a
 * voucher or send an email after, not inside.
 */

export type Client = Prisma.TransactionClient | typeof db;

/**
 * How long a caller will wait for its turn, and for the work, before giving up.
 * Tests shorten it with LOCK_WAIT_MS to reach the give-up path quickly.
 */
export const LOCK_WAIT_MS = Number(process.env.LOCK_WAIT_MS) > 0 ? Number(process.env.LOCK_WAIT_MS) : 30_000;

/** What callers say when they gave up waiting. */
export const BUSY_MESSAGE = "The system is busy — too many people are saving the same kind of record at once. Try again in a moment.";

/**
 * Whether an error means "gave up waiting", as opposed to a fault.
 *
 * A caller that throws this instead of refusing politely can leave a half-done
 * job behind: the Pre-Prod stress test left 23 stock movements with no voucher
 * because a posting that timed out threw, and the movement was only removed
 * when posting returned a refusal. So every caller turns these into a refusal.
 *
 *   P2028      Prisma: the transaction could not start, or ran out of time.
 *   P2024      Prisma: no database connection became free in time.
 *   LOCK_TIMEOUT  this module, on SQLite: waited too long for the queue.
 */
export const isBusy = (err: unknown): boolean => ["P2028", "P2024", "LOCK_TIMEOUT"].includes(String((err as { code?: string })?.code ?? ""));

const provider = (): string => String((db as unknown as { _activeProvider?: string })._activeProvider ?? "");
export const usesAdvisoryLocks = (): boolean => provider() === "postgresql";

/* ------------------------------------------------------------- in memory -- */

const queues = new Map<string, Promise<void>>();

async function inProcess<T>(keys: string[], work: () => Promise<T>): Promise<T> {
  const releases: (() => void)[] = [];
  // Always in the same order, so two callers wanting the same pair of keys can
  // never each hold one and wait for the other.
  for (const key of keys) {
    const before = queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const tail = before.then(() => mine);
    queues.set(key, tail);
    const done = () => {
      release();
      if (queues.get(key) === tail) queues.delete(key);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = await Promise.race([
      before.then(() => true),
      new Promise<false>((r) => (timer = setTimeout(() => r(false), LOCK_WAIT_MS))),
    ]);
    clearTimeout(timer);
    if (!waited) {
      // Give up our place without blocking whoever queued behind us, and let go
      // of anything already held.
      done();
      for (const r of releases.reverse()) r();
      throw Object.assign(new Error(`Waited more than ${LOCK_WAIT_MS} ms for ${key}`), { code: "LOCK_TIMEOUT" });
    }
    releases.push(done);
  }
  try {
    return await work();
  } finally {
    for (const r of releases.reverse()) r();
  }
}

/* ------------------------------------------------------------------ both -- */

export async function serialised<T>(keys: string[], work: (client: Client) => Promise<T>): Promise<T> {
  const ordered = [...new Set(keys)].sort();
  if (!usesAdvisoryLocks()) return inProcess(ordered, () => work(db));

  return db.$transaction(
    async (tx) => {
      for (const key of ordered) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      }
      return work(tx);
    },
    { maxWait: LOCK_WAIT_MS, timeout: LOCK_WAIT_MS },
  );
}

/* ------------------------------------------------------------- the keys -- */

/** The shelf: one item in one store. */
export const shelfKey = (companyId: string, itemId: string, storeId: string) => `stock:${companyId}:${itemId}:${storeId}`;

/** One purchase order line, while deliveries are weighed against it. */
export const orderLineKey = (orderLineId: string) => `po-line:${orderLineId}`;

/** A numbering series: vouchers, orders, requests, enquiries and the rest. */
export const seriesKey = (companyId: string, series: string) => `series:${companyId}:${series}`;

/** Whether an error is a unique-index clash, the kind a retry can get past. */
export const isUniqueClash = (err: unknown): boolean => (err as { code?: string })?.code === "P2002";
