/**
 * An amount written out in words, the way UAE commercial documents carry it.
 *
 *   1,726,149.18  ->  "UAE Dirhams One Million Seven Hundred Twenty-Six Thousand
 *                      One Hundred Forty-Nine and Eighteen Fils Only"
 *
 * Quotations, purchase orders and cheques print it under the total because a
 * figure can be altered with one stroke and a sentence cannot. International
 * (short-scale) numbering, which is what UAE banks and contracts use — not
 * lakhs and crores.
 *
 * Not server-only, and no database.
 */

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const SCALES = ["", "Thousand", "Million", "Billion", "Trillion"];

/** 0 to 999 in words. Empty for nought, so the caller decides what nought says. */
function belowThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest < 20) {
    if (rest) parts.push(ONES[rest]);
  } else {
    const t = TENS[Math.floor(rest / 10)];
    const o = ONES[rest % 10];
    parts.push(o ? `${t}-${o}` : t);
  }
  return parts.join(" ");
}

/** A whole number in words. "Zero" for nought. */
export function wholeInWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "Zero";
  const groups: string[] = [];
  let scale = 0;
  while (n > 0 && scale < SCALES.length) {
    const chunk = n % 1000;
    if (chunk) groups.unshift(SCALES[scale] ? `${belowThousand(chunk)} ${SCALES[scale]}` : belowThousand(chunk));
    n = Math.floor(n / 1000);
    scale += 1;
  }
  return groups.join(" ");
}

/**
 * An amount in words with its currency, to the fils.
 *
 * Rounded to two places first, so 0.005 of floating-point noise cannot turn
 * "Eighteen Fils" into "Seventeen". A negative amount — a credit note — says so
 * rather than silently dropping the sign.
 */
export function amountInWords(amount: number, currency = "AED"): string {
  const cents = Math.round(Math.abs(Number(amount) || 0) * 100);
  const whole = Math.floor(cents / 100);
  const fils = cents % 100;
  const unit = currency === "AED" ? ["UAE Dirhams", "Fils"] : [currency, "Cents"];
  const main = `${unit[0]} ${wholeInWords(whole)}`;
  const tail = fils ? ` and ${wholeInWords(fils)} ${unit[1]}` : "";
  const sign = Number(amount) < 0 ? "Minus " : "";
  return `${sign}${main}${tail} Only`;
}
