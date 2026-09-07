/**
 * UAE identifier formats.
 *
 * These are the numbers a UAE employer is required to hold and to get right,
 * and each one has a downstream consumer that fails hard on a bad value:
 *
 *   IBAN          the bank rejects the WHOLE WPS SIF file on one malformed row.
 *                 Salaries miss the deadline, and MOHRE suspends new work
 *                 permits once wages are more than a few days late. The error
 *                 surfaces at the bank, days later, naming no row.
 *   Emirates ID   quoted on MOHRE and GPSSA filings.
 *   Labour card   the personId column in the WPS file.
 *   TRN           printed on every tax invoice; the FTA penalises an incorrect
 *                 tax invoice.
 *
 * Catching these at entry turns a bank rejection into a red field beside the
 * box the person is already typing in.
 *
 * Each validator takes what the user typed and returns the cleaned value or a
 * plain-English reason. Empty input is allowed and returns null — these fields
 * are filled in over time, and a half-complete profile must still be saveable.
 * Completeness is enforced where it matters, at WPS generation.
 *
 * Not server-only: the forms use these to show the error before submitting.
 */

export type Cleaned = { value: string | null; error?: string };

const strip = (raw: string) => raw.replace(/[\s-]/g, "").toUpperCase();

/**
 * UAE IBAN: AE, two check digits, a 3-digit bank code and a 16-digit account —
 * 23 characters in total. Also verified with the ISO 7064 mod-97 checksum,
 * which is what catches a transposed pair of digits; a length check alone would
 * pass "AE07 0331 2345 6789 0123 456" with two digits swapped.
 */
export function cleanIban(raw: string): Cleaned {
  const t = strip(raw);
  if (!t) return { value: null };
  if (!t.startsWith("AE")) return { value: null, error: "A UAE IBAN starts with AE" };
  if (t.length !== 23) {
    return { value: null, error: `A UAE IBAN is 23 characters (AE plus 21 digits) — this has ${t.length}` };
  }
  if (!/^AE\d{21}$/.test(t)) return { value: null, error: "A UAE IBAN is AE followed by 21 digits" };
  if (!mod97(t)) return { value: null, error: "That IBAN's check digits do not match — check for a typo" };
  return { value: t };
}

/** ISO 7064 mod-97: move the first four characters to the end, letters to digits, remainder must be 1. */
function mod97(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  // The number is far beyond Number.MAX_SAFE_INTEGER, so take the remainder in chunks.
  let remainder = 0;
  for (const ch of digits) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder === 1;
}

/**
 * Emirates ID: 784-YYYY-NNNNNNN-C, 15 digits, always beginning 784. The year
 * part is the year of birth or issue and is sanity-checked rather than verified.
 */
export function cleanEmiratesId(raw: string): Cleaned {
  const t = strip(raw);
  if (!t) return { value: null };
  if (!/^\d{15}$/.test(t)) return { value: null, error: "An Emirates ID is 15 digits, like 784-1990-1234567-1" };
  if (!t.startsWith("784")) return { value: null, error: "An Emirates ID starts with 784" };
  const year = Number(t.slice(3, 7));
  if (year < 1900 || year > new Date().getUTCFullYear()) {
    return { value: null, error: `The year in that Emirates ID reads as ${year} — check the digits` };
  }
  // Stored with the separators, which is how it appears on the card.
  return { value: `${t.slice(0, 3)}-${t.slice(3, 7)}-${t.slice(7, 14)}-${t.slice(14)}` };
}

/** UAE Tax Registration Number: 15 digits. */
export function cleanTrn(raw: string): Cleaned {
  const t = strip(raw);
  if (!t) return { value: null };
  if (!/^\d{15}$/.test(t)) return { value: null, error: "A TRN is 15 digits" };
  return { value: t };
}

/**
 * Labour card / MOHRE personal number — 14 digits, and the personId column of
 * the WPS file. Digits only, because the bank's parser takes it positionally.
 */
export function cleanLabourCard(raw: string): Cleaned {
  const t = strip(raw);
  if (!t) return { value: null };
  if (!/^\d{9,15}$/.test(t)) {
    return { value: null, error: "A labour card number is digits only (usually 14)" };
  }
  return { value: t };
}

/** Bank routing code used by WPS — 9 digits, issued by the UAE Central Bank. */
export function cleanRouting(raw: string): Cleaned {
  const t = strip(raw);
  if (!t) return { value: null };
  if (!/^\d{9}$/.test(t)) return { value: null, error: "A bank routing code is 9 digits" };
  return { value: t };
}

/** Which employee fields are format-checked, and by what. */
export const EMPLOYEE_VALIDATORS: Record<string, (raw: string) => Cleaned> = {
  iban: cleanIban,
  emiratesIdNo: cleanEmiratesId,
  labourCardNo: cleanLabourCard,
  bankRoutingCode: cleanRouting,
};
