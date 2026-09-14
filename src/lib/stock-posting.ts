import "server-only";
import { db } from "./db";
import { postVoucher } from "./posting";
import { accountsForPosting } from "./accounts";
import {
  balanceOf, priceReceipt, priceIssue, checkIssue, isInward,
  MOVEMENT_KINDS, type StockBalance,
} from "./stock";

/**
 * Turning a stock movement into accounting.
 *
 * What the ledger has to say
 * --------------------------
 * Material arriving is an asset, not a cost. It becomes a cost on the day it is
 * issued to a job, which is the day it stops being ours and starts being that
 * contract's. Getting this the wrong way round is what makes a month look
 * terrible because a delivery landed on the 30th, and the month after look
 * wonderful for the same reason.
 *
 * Receipt              inventory up, goods-received-not-invoiced up.
 *                      The supplier is owed even though nothing is billed yet.
 * Issue to a job       site materials up, tagged to the job; inventory down.
 * Return to store      the reverse of an issue, at the cost it went out at.
 * Return to supplier   inventory down, what is owed for it down with it.
 * Adjustment           inventory and site materials, with no job. Material
 *                      paid for that no contract ever received.
 * Transfer             nothing at all. Moving a drum of cable from the main
 *                      store to a site container changes where it is, not what
 *                      the company owns, so there is no voucher to write.
 *
 * Why an issue is priced here and not on the form
 * -----------------------------------------------
 * The weighted average moves every time something is received, so the price of
 * an issue depends on the moment it happens. Deciding it in the browser means
 * deciding it from a figure that may already be stale. It is read and applied
 * in the same place, against the movements as they stand.
 */

export type StockResult =
  | { ok: true; movementId: string; entryId: string | null; reference: string | null; unitCost: number; value: number }
  | { ok: false; error: string };

/** The movements for one item in one store — the ledger the shelf is read from. */
export async function balanceFor(companyId: string, itemId: string, storeId: string): Promise<StockBalance> {
  const movements = await db.stockMovement.findMany({
    where: { companyId, itemId, storeId },
    select: { kind: true, quantity: true, value: true },
  });
  return balanceOf(movements);
}

export type MovementInput = {
  companyId: string;
  postedBy: string;
  kind: string;
  itemId: string;
  storeId: string;
  date: string;
  quantity: number;
  /** Required on a receipt. Ignored on anything priced from the shelf. */
  unitCost?: number;
  jobId?: string | null;
  partyId?: string | null;
  reference: string;
  notes?: string | null;
};

/** Kinds whose value comes from what is already on the shelf. */
const PRICED_FROM_SHELF = new Set(["Issue", "Return to supplier", "Adjustment out", "Transfer out"]);

/**
 * Record a movement and post what it does to the books.
 *
 * The row is written first so the voucher has something to be tied to, and
 * removed again if the posting is refused — the same order the advances
 * register uses, and for the same reason.
 */
export async function recordMovement(input: MovementInput): Promise<StockResult> {
  const kind = String(input.kind);
  if (!(MOVEMENT_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: "That is not a kind of stock movement." };
  }
  const reference = (input.reference ?? "").trim().slice(0, 120);
  if (!reference) return { ok: false, error: "Enter the delivery note, issue note or count sheet this comes from." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "")) return { ok: false, error: "Enter the date it moved." };

  const item = await db.item.findFirst({ where: { id: input.itemId, companyId: input.companyId } });
  if (!item) return { ok: false, error: "That item is not in this company." };
  const store = await db.store.findFirst({ where: { id: input.storeId, companyId: input.companyId } });
  if (!store) return { ok: false, error: "That store is not in this company." };

  if (!item.isStocked) {
    return {
      ok: false,
      error: `${item.name} is not a stocked item, so there is no shelf for it to move on or off. Charge it straight to the job on a supplier invoice instead.`,
    };
  }

  if (input.jobId && !(await db.job.findFirst({ where: { id: input.jobId, companyId: input.companyId } }))) {
    return { ok: false, error: "That job is not in this company." };
  }
  if (input.partyId && !(await db.party.findFirst({ where: { id: input.partyId, companyId: input.companyId } }))) {
    return { ok: false, error: "That supplier is not in this company." };
  }

  // An issue with no job is material walking out of the store to nowhere. It is
  // the single easiest way for a contract to look more profitable than it is.
  if (kind === "Issue" && !input.jobId) {
    return { ok: false, error: "Choose the job this material is going to. An issue with no job puts the cost on nothing." };
  }

  const balance = await balanceFor(input.companyId, input.itemId, input.storeId);

  let priced;
  if (PRICED_FROM_SHELF.has(kind)) {
    const permitted = checkIssue(input.quantity, balance, item.name);
    if (!permitted.ok) return { ok: false, error: permitted.error };
    priced = priceIssue(input.quantity, balance);
  } else {
    const cost = Number(input.unitCost);
    if (!Number.isFinite(cost) || cost < 0) return { ok: false, error: "Enter what one unit cost." };
    priced = priceReceipt(input.quantity, cost);
    if (priced.quantity <= 0) return { ok: false, error: "Enter how much arrived." };
  }

  const row = await db.stockMovement.create({
    data: {
      companyId: input.companyId,
      itemId: item.id,
      storeId: store.id,
      kind,
      date: new Date(input.date + "T00:00:00.000Z"),
      quantity: priced.quantity,
      unitCost: priced.unitCost,
      value: priced.value,
      jobId: input.jobId ?? null,
      partyId: input.partyId ?? null,
      reference,
      notes: input.notes ?? null,
      createdBy: input.postedBy,
    },
  });

  // A transfer changes where stock is, not what the company owns, so there is
  // nothing to post. The movement is still recorded — the shelf moved.
  if (kind === "Transfer in" || kind === "Transfer out") {
    return { ok: true, movementId: row.id, entryId: null, reference: null, unitCost: priced.unitCost, value: priced.value };
  }

  const resolved = await accountsForPosting(input.companyId, [
    "inventory",
    kind === "Receipt" || kind === "Return to supplier" ? "goodsReceivedNotInvoiced" : "materialCost",
  ]);
  if (!resolved.ok) {
    await db.stockMovement.delete({ where: { id: row.id } });
    return { ok: false, error: resolved.error };
  }
  const inventory = resolved.ids.inventory;
  const counter = resolved.ids[kind === "Receipt" || kind === "Return to supplier" ? "goodsReceivedNotInvoiced" : "materialCost"];

  // Stock going up debits inventory; stock going down credits it. The other
  // side follows from which kind it is.
  const up = isInward(kind);
  const amount = priced.value;

  const posted = await postVoucher({
    companyId: input.companyId,
    postedBy: input.postedBy,
    voucherType: "Journal",
    date: input.date,
    partyId: input.partyId ?? null,
    memo: `${kind} — ${item.code} ${item.name} (${reference})`,
    lines: up
      ? [
          { accountId: inventory, debit: amount, credit: 0 },
          { accountId: counter, debit: 0, credit: amount, jobId: input.jobId ?? null },
        ]
      : [
          { accountId: counter, debit: amount, credit: 0, jobId: input.jobId ?? null },
          { accountId: inventory, debit: 0, credit: amount },
        ],
    sourceType: "stock-movement",
    sourceId: row.id,
    source: "stock",
  });
  if (!posted.ok) {
    await db.stockMovement.delete({ where: { id: row.id } });
    return posted;
  }

  await db.stockMovement.update({ where: { id: row.id }, data: { entryId: posted.entryId } });
  return {
    ok: true,
    movementId: row.id,
    entryId: posted.entryId,
    reference: posted.reference,
    unitCost: priced.unitCost,
    value: priced.value,
  };
}

/**
 * Move stock between two stores.
 *
 * Written as a pair, because half a transfer is stock that has left one shelf
 * and arrived nowhere. Both rows carry the same reference so the two ends can
 * always be found together, and the second is priced at what the first took.
 */
export async function transferStock(
  input: Omit<MovementInput, "kind"> & { toStoreId: string },
): Promise<{ ok: true; out: string; in: string } | { ok: false; error: string }> {
  if (input.toStoreId === input.storeId) {
    return { ok: false, error: "Choose a different store to move it to." };
  }
  const to = await db.store.findFirst({ where: { id: input.toStoreId, companyId: input.companyId } });
  if (!to) return { ok: false, error: "That store is not in this company." };

  const out = await recordMovement({ ...input, kind: "Transfer out" });
  if (!out.ok) return out;

  const arrival = await recordMovement({
    ...input,
    kind: "Transfer in",
    storeId: to.id,
    // At what it left the other shelf for, so value does not appear from nowhere.
    unitCost: out.unitCost,
  });
  if (!arrival.ok) {
    // Never leave stock in transit. The half that worked is undone.
    await db.stockMovement.delete({ where: { id: out.movementId } });
    return arrival;
  }
  return { ok: true, out: out.movementId, in: arrival.movementId };
}
