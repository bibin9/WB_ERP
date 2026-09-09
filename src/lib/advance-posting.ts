import "server-only";
import { db } from "./db";
import { postVoucher } from "./posting";
import { accountsForPosting } from "./accounts";
import { toFils, money } from "./money";
import { checkRecovery, outstanding, DIRECTIONS } from "./advances";

/**
 * Turning an advance into accounting.
 *
 * The register and the ledger are two records of the same money, and this is
 * the only place that writes both. It sits in lib rather than in the screen's
 * actions for the same reason invoice posting does: a server action needs a
 * request behind it, so anything living there can only be tested by reading it
 * as text. The rules that decide which account is debited are worth more than
 * that, so they are here, where a test can call them against a real database.
 *
 * Everything still goes through postVoucher(), the single seam every module
 * posts through. It owns voucher numbering, the closed-period lock, the balance
 * check and the concurrency retry.
 *
 * The one rule that matters
 * ------------------------
 * An advance never touches income or expense. Nothing has been supplied when
 * the money moves, so one received is a liability and one paid is an asset.
 * Booking either through the profit and loss flatters the month it arrived and
 * starves every month after it. The only exception is a write-off, which is a
 * decision rather than a correction and is meant to reach the P&L.
 */

export type AdvanceResult = { ok: true; advanceId: string; entryId: string; reference: string } | { ok: false; error: string };
export type SimpleResult = { ok: true; entryId: string; reference: string } | { ok: false; error: string };

export type RecordAdvanceInput = {
  companyId: string;
  postedBy: string;
  direction: string;
  reference: string;
  partyId: string;
  bankAccountId: string;
  date: string;
  amount: number;
  jobId?: string | null;
  recoveryPercent?: number | null;
  notes?: string | null;
};

/**
 * Record an advance and post it.
 *
 * Unlike retention, this posts: the money has already moved, and if this does
 * not put it in the ledger then nothing will. The row is written first so the
 * voucher has something to be tied to, and removed again if the posting is
 * refused — a register entry with no voucher is the orphan worth avoiding.
 */
export async function recordAdvance(input: RecordAdvanceInput): Promise<AdvanceResult> {
  const direction = (DIRECTIONS as readonly string[]).includes(input.direction) ? input.direction : "Received";
  const reference = (input.reference ?? "").trim().slice(0, 120);
  const amount = toFils(Number(input.amount) || 0);

  if (!reference) return { ok: false, error: "Enter a reference — their receipt number, or the contract clause it came under" };
  if (amount <= 0) return { ok: false, error: "Enter the amount advanced" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "")) return { ok: false, error: "Enter the date the money moved" };

  const received = direction === "Received";
  if (!input.partyId) {
    return {
      ok: false,
      error: received
        ? "Choose the customer who paid it. An advance with no customer cannot be recovered against their invoices."
        : "Choose the supplier it was paid to. An advance with no supplier cannot be set against their bills.",
    };
  }

  const party = await db.party.findFirst({ where: { id: input.partyId, companyId: input.companyId } });
  if (!party) return { ok: false, error: "That customer or supplier is not on this company" };

  if (input.jobId && !(await db.job.findFirst({ where: { id: input.jobId, companyId: input.companyId } }))) {
    return { ok: false, error: "That job is not in this company" };
  }

  // Cash and bank only. Letting the whole chart through here is how an advance
  // ends up credited to revenue, which is the exact mistake this register
  // exists to prevent.
  const bank = input.bankAccountId
    ? await db.chartOfAccount.findFirst({ where: { id: input.bankAccountId, companyId: input.companyId } })
    : null;
  if (!bank) return { ok: false, error: "Choose the bank or cash account the money moved through" };

  const clash = await db.partyAdvance.findFirst({ where: { companyId: input.companyId, direction, reference } });
  if (clash) return { ok: false, error: `${reference} is already on the register for ${money(clash.amount)}.` };

  const resolved = await accountsForPosting(input.companyId, [received ? "customerAdvances" : "supplierAdvances"]);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const advanceAccountId = resolved.ids[received ? "customerAdvances" : "supplierAdvances"];

  const pct = Number(input.recoveryPercent);
  const row = await db.partyAdvance.create({
    data: {
      companyId: input.companyId,
      direction,
      reference,
      partyId: party.id,
      partyName: party.name,
      jobId: input.jobId ?? null,
      date: new Date(input.date + "T00:00:00.000Z"),
      amount,
      recoveryPercent: Number.isFinite(pct) && pct > 0 && pct <= 100 ? pct : null,
      notes: input.notes ?? null,
      status: "Open",
    },
  });

  const posted = await postVoucher({
    companyId: input.companyId,
    postedBy: input.postedBy,
    voucherType: received ? "Receipt" : "Payment",
    date: input.date,
    partyId: party.id,
    memo: `Advance ${received ? "received from" : "paid to"} ${party.name} — ${reference}`,
    lines: received
      ? [
          { accountId: bank.id, debit: amount, credit: 0 },
          { accountId: advanceAccountId, debit: 0, credit: amount, jobId: input.jobId ?? null },
        ]
      : [
          { accountId: advanceAccountId, debit: amount, credit: 0, jobId: input.jobId ?? null },
          { accountId: bank.id, debit: 0, credit: amount },
        ],
    sourceType: "party-advance",
    sourceId: row.id,
    source: "advances",
  });
  if (!posted.ok) {
    // Nothing reached the ledger, so nothing should be left in the register.
    await db.partyAdvance.delete({ where: { id: row.id } });
    return posted;
  }

  await db.partyAdvance.update({ where: { id: row.id }, data: { entryId: posted.entryId } });
  return { ok: true, advanceId: row.id, entryId: posted.entryId, reference: posted.reference };
}

export type RecoverAdvanceInput = {
  advanceId: string;
  postedBy: string;
  amount: number;
  date: string;
  invoiceId?: string | null;
  notes?: string | null;
};

/**
 * Set an advance against an invoice.
 *
 * This moves no money. The invoice is settled in part by an amount the other
 * party already handed over, so the entry runs between the advance account and
 * the ordinary receivable or payable and the bank is untouched. People expect
 * otherwise, which is why the screen says so twice.
 */
export async function recoverAdvance(input: RecoverAdvanceInput): Promise<SimpleResult> {
  const row = await db.partyAdvance.findUnique({ where: { id: input.advanceId }, include: { recoveries: true } });
  if (!row) return { ok: false, error: "Not found" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "")) {
    return { ok: false, error: "Enter the date of the certificate or invoice this comes off" };
  }

  const amount = toFils(Number(input.amount) || 0);
  const permitted = checkRecovery(row, amount);
  if (!permitted.ok) return { ok: false, error: permitted.error };

  // A named invoice has to belong to the same company and the same party, or
  // the set-off lands on somebody else's balance.
  let invoice = null;
  if (input.invoiceId) {
    invoice = await db.invoice.findFirst({ where: { id: input.invoiceId, companyId: row.companyId } });
    if (!invoice) return { ok: false, error: "That invoice is not in this company" };
    if (row.partyId && invoice.partyId && invoice.partyId !== row.partyId) {
      return { ok: false, error: "That invoice belongs to a different customer or supplier." };
    }
  }

  const received = row.direction === "Received";
  const resolved = await accountsForPosting(row.companyId, [
    received ? "customerAdvances" : "supplierAdvances",
    received ? "accountsReceivable" : "accountsPayable",
  ]);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const advanceAccountId = resolved.ids[received ? "customerAdvances" : "supplierAdvances"];
  const ordinaryAccountId = resolved.ids[received ? "accountsReceivable" : "accountsPayable"];

  const rec = await db.partyAdvanceRecovery.create({
    data: {
      advanceId: row.id,
      date: new Date(input.date + "T00:00:00.000Z"),
      amount,
      invoiceId: invoice?.id ?? null,
      notes: input.notes ?? null,
    },
  });

  const posted = await postVoucher({
    companyId: row.companyId,
    postedBy: input.postedBy,
    voucherType: "Journal",
    date: input.date,
    partyId: row.partyId,
    memo: `Advance recovered against ${invoice ? invoice.number : "invoices"} — ${row.reference}`,
    lines: received
      ? [
          // The liability comes down; the customer owes us that much less.
          { accountId: advanceAccountId, debit: amount, credit: 0, jobId: row.jobId },
          { accountId: ordinaryAccountId, debit: 0, credit: amount },
        ]
      : [
          // We owe the supplier less, because they are holding our money.
          { accountId: ordinaryAccountId, debit: amount, credit: 0 },
          { accountId: advanceAccountId, debit: 0, credit: amount, jobId: row.jobId },
        ],
    sourceType: "advance-recovery",
    sourceId: rec.id,
    source: "advances",
  });
  if (!posted.ok) {
    await db.partyAdvanceRecovery.delete({ where: { id: rec.id } });
    return posted;
  }

  await db.partyAdvanceRecovery.update({ where: { id: rec.id }, data: { entryId: posted.entryId } });

  // Close it the moment nothing is left, rather than waiting for somebody to
  // notice. An advance sitting Open at nil is what stops a register being
  // trusted.
  const after = await db.partyAdvance.findUnique({ where: { id: row.id }, include: { recoveries: true } });
  if (after && outstanding(after) === 0) {
    await db.partyAdvance.update({ where: { id: row.id }, data: { status: "Recovered" } });
  }

  return { ok: true, entryId: posted.entryId, reference: posted.reference };
}

export type CloseAdvanceInput = {
  advanceId: string;
  postedBy: string;
  status: string;
  date: string;
  /** Where the refund moved through, when refunding. */
  bankAccountId?: string | null;
  /** Where the loss is taken, when writing off. */
  writeOffAccountId?: string | null;
};

/**
 * Give an advance back, or give up on it.
 *
 * A refund moves real money and reverses the original entry. A write-off does
 * not: it takes the remaining balance to the profit and loss, which is the one
 * time an advance is allowed to reach it — because by then it is a loss, not an
 * advance.
 */
export async function closeAdvance(input: CloseAdvanceInput): Promise<SimpleResult> {
  const row = await db.partyAdvance.findUnique({ where: { id: input.advanceId }, include: { recoveries: true } });
  if (!row) return { ok: false, error: "Not found" };
  if (row.status !== "Open") return { ok: false, error: `This advance is already ${row.status.toLowerCase()}.` };

  if (input.status !== "Refunded" && input.status !== "Written off") {
    return { ok: false, error: "Choose whether it is being refunded or written off" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "")) return { ok: false, error: "Enter the date" };

  const left = outstanding(row);
  if (left <= 0) return { ok: false, error: "Nothing is left on this advance." };

  const received = row.direction === "Received";
  let counterAccountId: string;
  if (input.status === "Refunded") {
    const bank = input.bankAccountId
      ? await db.chartOfAccount.findFirst({ where: { id: input.bankAccountId, companyId: row.companyId } })
      : null;
    if (!bank) return { ok: false, error: "Choose the bank or cash account the refund moved through" };
    counterAccountId = bank.id;
  } else {
    const acc = input.writeOffAccountId
      ? await db.chartOfAccount.findFirst({ where: { id: input.writeOffAccountId, companyId: row.companyId } })
      : null;
    if (!acc) return { ok: false, error: "Choose the account the write-off should be taken to" };
    counterAccountId = acc.id;
  }

  const resolved = await accountsForPosting(row.companyId, [received ? "customerAdvances" : "supplierAdvances"]);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const advanceAccountId = resolved.ids[received ? "customerAdvances" : "supplierAdvances"];

  // Whichever way it ends, the advance account is cleared of what is left. A
  // customer advance is a liability, so clearing it is a debit; a supplier
  // advance is an asset, so clearing it is a credit.
  const posted = await postVoucher({
    companyId: row.companyId,
    postedBy: input.postedBy,
    voucherType: input.status === "Refunded" ? (received ? "Payment" : "Receipt") : "Journal",
    date: input.date,
    partyId: row.partyId,
    memo: `Advance ${input.status.toLowerCase()} — ${row.reference}`,
    lines: received
      ? [
          { accountId: advanceAccountId, debit: left, credit: 0, jobId: row.jobId },
          { accountId: counterAccountId, debit: 0, credit: left },
        ]
      : [
          { accountId: counterAccountId, debit: left, credit: 0 },
          { accountId: advanceAccountId, debit: 0, credit: left, jobId: row.jobId },
        ],
    sourceType: "advance-close",
    sourceId: row.id,
    source: "advances",
  });
  if (!posted.ok) return posted;

  await db.partyAdvance.update({ where: { id: input.advanceId }, data: { status: input.status } });
  return { ok: true, entryId: posted.entryId, reference: posted.reference };
}
