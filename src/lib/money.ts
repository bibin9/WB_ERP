/**
 * Money formatting and rounding, in one place.
 *
 * The UAE dirham has 100 fils, so an amount on screen always carries exactly
 * two decimals. `Number.toLocaleString()` with no options does not: it drops
 * the decimals on a whole number and shows up to three on anything else, so a
 * column reads 1,000 / 1,000.5 / 1,000.505 down the page and the fils appear to
 * come and go. In an accounting screen that reads as an error in the figures.
 *
 * Not server-only: the voucher form needs the same formatting as the ledger it
 * will be read against.
 */

/** An amount, always with two decimals and thousands separators. 1000 -> "1,000.00". */
export const money = (v: number | null | undefined): string =>
  v == null || Number.isNaN(v)
    ? "—"
    // `v + 0` alone keeps negative zero, and "-0.00" on a reconciliation reads
    // as a real difference. Nothing that rounds to nothing should carry a sign.
    : (Math.abs(v) < 0.005 ? 0 : v).toLocaleString("en-AE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

/** The same, with the currency in front, for prose and audit lines. */
export const aed = (v: number | null | undefined): string => (v == null ? "—" : `AED ${money(v)}`);

/**
 * Round to fils.
 *
 * Everything written to a money column goes through this. Not because doubles
 * drift — they do not, at any volume this system will see; balanced pairs are
 * bit-identical and 200,000 values summed in opposite orders differ by 7e-5,
 * which rounds to nothing. The real defect is storing a value that was never
 * a real amount of money: a VAT extraction or a proration yields 1234.5678,
 * the screen shows 1,234.57, and a report that sums before rounding disagrees
 * with one that rounds before summing. Rounding at the point of storage means
 * every stored figure is an amount somebody could actually pay.
 */
export const toFils = (v: number): number => Math.round((Number(v) || 0) * 100) / 100;
