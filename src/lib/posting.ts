import "server-only";
import { db } from "./db";
import { financialYear } from "./period";
import { VAT_TREATMENTS } from "./vat";
import { toFils } from "./money";

/**
 * Posting a voucher.
 *
 * This is the one way anything gets into the ledgers, and it is deliberately
 * not a form action: Projects, Inventory and Payroll will all need to post, and
 * none of them should be building a FormData or holding finance permissions to
 * do it. The screen's action parses its form and calls this; another module
 * calls it directly with its own permission check already made.
 *
 * Every rule that protects the books lives here rather than in the screen —
 * balance, the period lock, the party belonging to the company, sane dates,
 * and one voucher per source document. A module that bypasses this bypasses
 * all of it, which is why nothing else writes to JournalEntry.
 */

export const VOUCHER_PREFIX: Record<string, string> = {
  Journal: "JV",
  Payment: "PV",
  Receipt: "RV",
  Contra: "CV",
  Sales: "SI",
  Purchase: "PI",
  // A credit note goes to a customer (sales return, rate variation, retention
  // release); a debit note goes to a supplier. Both are everyday documents on a
  // contract and reduce the VAT already declared.
  "Credit Note": "CN",
  "Debit Note": "DN",
};

export type PostingLine = {
  accountId: string;
  debit: number;
  credit: number;
  vatTreatment?: string | null;
  jobId?: string | null;
  costCentreId?: string | null;
};

export type PostingInput = {
  companyId: string;
  /** Who is posting, for the audit trail. */
  postedBy: string;
  voucherType: string;
  /** ISO yyyy-mm-dd. Defaults to today. */
  date?: string | Date | null;
  partyId?: string | null;
  vatAmount?: number;
  memo?: string | null;
  lines: PostingLine[];
  /**
   * The document behind this voucher, when another module raised it — the
   * module and the id, e.g. { sourceType: "grn", sourceId: receipt.id }.
   * Posting the same document twice is refused.
   */
  sourceType?: string | null;
  sourceId?: string | null;
  /** Free-text origin: "manual", "tally", or the module's name. */
  source?: string;
};

export type PostingResult =
  | { ok: true; entryId: string; reference: string }
  | { ok: false; error: string };

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return new Date();
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(value + "T00:00:00.000Z");
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Write a balanced voucher to the ledgers.
 *
 * Does no permission checking — the caller knows who is asking and what they
 * are allowed to do. It does check everything about the voucher itself.
 */
/**
 * How many times to try for a free voucher number before giving up.
 *
 * Each attempt re-reads the count, so the guess improves as other writers land;
 * twenty simultaneous posts settle well inside this. The limit exists so a
 * pathological case ends in a sentence rather than a spin.
 */
const MAX_REFERENCE_ATTEMPTS = 25;

/**
 * Which unique index refused an insert, if one did.
 *
 * Prisma reports P2002 with the offending fields in `meta.target`, whose shape
 * differs between PostgreSQL and SQLite — an array of fields on one, a
 * constraint name on the other — so it is flattened to a string and read for
 * the field names rather than matched exactly.
 */
function uniqueClash(err: unknown): "reference" | "source" | null {
  const e = err as { code?: string; meta?: { target?: unknown } };
  if (e?.code !== "P2002") return null;
  const target = JSON.stringify(e.meta?.target ?? "").toLowerCase();
  if (target.includes("sourceid") || target.includes("sourcetype")) return "source";
  if (target.includes("reference")) return "reference";
  return null;
}

export async function postVoucher(input: PostingInput): Promise<PostingResult> {
  const company = await db.company.findUnique({ where: { id: input.companyId } });
  if (!company) return { ok: false, error: "Company not found" };

  // The voucher date is the accountant's, not the clock's.
  const date = parseDate(input.date);
  if (!date) return { ok: false, error: "Enter a valid date" };

  // A closed period must stay closed: once a VAT return is filed, the figures
  // behind it cannot be allowed to move.
  if (company.booksLockedTo && date <= company.booksLockedTo) {
    const upto = company.booksLockedTo.toISOString().slice(0, 10);
    return {
      ok: false,
      error: `The books are closed up to ${upto}. Post this on a later date, or ask an administrator to change the lock.`,
    };
  }

  // A date far in the future is nearly always a typo in the year.
  if (date > new Date(Date.now() + 366 * 24 * 3600 * 1000)) {
    return { ok: false, error: "That date is more than a year ahead — check the year." };
  }

  // The party is a master record, so outstanding can actually be totalled. Its
  // name is snapshotted on the voucher for the printed document.
  let partyName: string | null = null;
  if (input.partyId) {
    const party = await db.party.findFirst({ where: { id: input.partyId, companyId: input.companyId } });
    if (!party) return { ok: false, error: "That customer or supplier is not on this company" };
    partyName = party.name;
  }

  // Rounded to fils on the way in. A VAT extraction or a proration produces
  // 1119.571428…, which is not an amount anybody can pay: the screen would show
  // 1,119.57 while the stored figure carried a tail, and a report that sums
  // before rounding would then disagree with one that rounds before summing.
  const lines = input.lines
    .map((l) => ({
      accountId: l.accountId,
      debit: toFils(l.debit),
      credit: toFils(l.credit),
      // Only a treatment the VAT return knows about is stored.
      vatTreatment: VAT_TREATMENTS.includes(l.vatTreatment as never) ? l.vatTreatment ?? null : null,
      jobId: l.jobId || null,
      costCentreId: l.costCentreId || null,
    }))
    .filter((l) => l.accountId && (l.debit > 0 || l.credit > 0));

  if (lines.length < 2) return { ok: false, error: "At least two lines are required" };

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100) || totalDebit === 0) {
    return { ok: false, error: "Entry is not balanced (debits must equal credits)" };
  }

  // Accounts must belong to this company, or a voucher could post into another
  // company's books. A module passing ids from elsewhere would not notice.
  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const valid = await db.chartOfAccount.count({ where: { id: { in: accountIds }, companyId: input.companyId } });
  if (valid !== accountIds.length) return { ok: false, error: "An account does not belong to this company" };

  // Same for jobs: costing must not be tagged to another company's contract.
  const jobIds = [...new Set(lines.map((l) => l.jobId).filter(Boolean))] as string[];
  if (jobIds.length) {
    const jobs = await db.job.count({ where: { id: { in: jobIds }, companyId: input.companyId } });
    if (jobs !== jobIds.length) return { ok: false, error: "A job does not belong to this company" };
  }

  // And the same for the other dimension.
  const centreIds = [...new Set(lines.map((l) => l.costCentreId).filter(Boolean))] as string[];
  if (centreIds.length) {
    const centres = await db.costCentre.count({ where: { id: { in: centreIds }, companyId: input.companyId } });
    if (centres !== centreIds.length) return { ok: false, error: "A cost centre does not belong to this company" };
  }

  // A line is either a customer's job or the business's own overhead, never
  // both — otherwise the same cost is counted twice when the two reports are
  // read side by side.
  const both = lines.find((l) => l.jobId && l.costCentreId);
  if (both) return { ok: false, error: "A line can carry a job or a cost centre, not both" };

  // One voucher per source document. The unique index enforces it too; this
  // gives the caller a sentence rather than a constraint violation.
  if (input.sourceType && input.sourceId) {
    const already = await db.journalEntry.findFirst({
      where: { companyId: input.companyId, sourceType: input.sourceType, sourceId: input.sourceId },
      select: { reference: true },
    });
    if (already) {
      return { ok: false, error: `That document has already been posted, as ${already.reference}` };
    }
  }

  // Numbering restarts each financial year, the way Tally does, and carries the
  // year in the reference so two years can never collide.
  const fy = financialYear(company.fyStartMonth, date);
  const yearTag = `${String(fy.from.getUTCFullYear()).slice(2)}-${String(fy.to.getUTCFullYear()).slice(2)}`;
  const prefix = `${company.code}/${VOUCHER_PREFIX[input.voucherType] ?? "JV"}/${yearTag}/`;

  // Counting the vouchers and using count + 1 was a read-modify-write race, and
  // a stress test found how badly: twenty people posting at the same instant,
  // three got a voucher and seventeen got "Unique constraint failed on the
  // fields: (companyId, reference)". The unique index did its job — no two
  // vouchers ever shared a number, and nothing was corrupted — but a finance
  // team at month-end was being refused most of its work in a language nobody
  // could read.
  //
  // So the collision is expected rather than exceptional. Take the next number,
  // try it, and if somebody else got there first take the one after. The count
  // is re-read each time, so the guess improves as other writers land and the
  // loop converges in a handful of attempts even with twenty in flight.
  //
  // A database sequence would be tidier on PostgreSQL and unavailable on the
  // SQLite used for local development, and a number that behaves differently in
  // the two places is worse than one that retries in both.
  for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt++) {
    const n = await db.journalEntry.count({
      where: { companyId: input.companyId, voucherType: input.voucherType, date: { gte: fy.from, lte: fy.to } },
    });
    // The count, re-read, IS the next number — no attempt offset. Adding the
    // attempt would skip: three writers colliding on 0101 would take 0101,
    // 0103, 0105 and leave holes. A voucher sequence with gaps is the first
    // thing an auditor asks about, and "the software did it" is not an answer.
    const reference = `${prefix}${String(n + 1).padStart(4, "0")}`;

    try {
      const created = await db.journalEntry.create({
        data: {
          companyId: input.companyId,
          reference,
          date,
          voucherType: input.voucherType,
          partyId: input.partyId || null,
          partyName,
          vatAmount: toFils(input.vatAmount ?? 0),
          memo: input.memo || null,
          postedBy: input.postedBy,
          source: input.source ?? (input.sourceType ? input.sourceType : "manual"),
          sourceType: input.sourceType || null,
          sourceId: input.sourceId || null,
          lines: {
            create: lines.map((l) => ({
              accountId: l.accountId,
              debit: l.debit,
              credit: l.credit,
              vatTreatment: l.vatTreatment,
              jobId: l.jobId,
              costCentreId: l.costCentreId,
            })),
          },
        },
      });
      return { ok: true, entryId: created.id, reference };
    } catch (err) {
      // Two different unique indexes can refuse this insert and they mean
      // opposite things. A clash on the reference is two people numbering at
      // once — try again. A clash on the source document is the SAME document
      // being posted twice, which must stay a refusal: retrying it would post
      // the thing the index exists to prevent.
      const clash = uniqueClash(err);
      if (clash === "source") {
        return { ok: false, error: "That document has already been posted." };
      }
      if (clash !== "reference") throw err;
      // A little jitter so simultaneous writers stop marching in lockstep.
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 15)));
    }
  }

  return {
    ok: false,
    error:
      "Could not allocate a voucher number — too many people are posting to this company at once. Try again in a moment.",
  };
}
