/**
 * Numbering a document: MR-0001, PO-0007, RFQ-0002.
 *
 * Every register in this system numbers the same way — company code, document
 * prefix, two-digit year, then a padded serial — and until now each one wrote
 * that out again. Four copies of a rule is four chances for one of them to pad
 * to three digits, or to reuse a gap, or to be fixed once when a bug is found.
 *
 * Voucher numbering in `posting.ts` stayed where it is on purpose: it restarts
 * on the financial year rather than the calendar year, retries against a unique
 * index, and is the one numbering that money depends on. Pretending it is the
 * same rule as a purchase order's would mean bending one of them.
 *
 * The query stays with the caller, because the table does. Only the arithmetic
 * is here, which is the part that was actually being copied.
 *
 * Not server-only: a form can show the number a document will get.
 */

/** How wide the serial is. Four digits carries a register to 9,999 in a year. */
export const SERIAL_WIDTH = 4;

/**
 * The stem every number in one series shares: `WBE/PO/26/`.
 *
 * The year is the calendar year the document is raised in, not the financial
 * year. A purchase order is a commercial document and people look for it by
 * the year it was raised; a voucher is an accounting one and belongs to a
 * financial year. Those are different questions and they get different answers.
 */
export function documentStem(companyCode: string, prefix: string, on: Date = new Date()): string {
  const year = String(on.getUTCFullYear()).slice(2);
  return `${companyCode || "CO"}/${prefix}/${year}/`;
}

/**
 * The next number after the highest one already issued.
 *
 * Taken from the highest rather than from a count, because a count assumes the
 * series has no gaps — and one deleted document is enough to make it hand out a
 * number somebody already has. That exact assumption stopped a company posting
 * for a financial year before it was found, so it is not repeated here.
 *
 * A number that does not parse is treated as no number at all. A stray row
 * whose reference was written by hand should not be able to stop the register.
 */
export function nextInSeries(stem: string, lastNumber: string | null | undefined): string {
  const tail = lastNumber && lastNumber.startsWith(stem) ? Number(lastNumber.slice(stem.length)) : NaN;
  const next = Number.isFinite(tail) ? tail + 1 : 1;
  return stem + String(next).padStart(SERIAL_WIDTH, "0");
}
