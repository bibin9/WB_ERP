/**
 * UAE VAT.
 *
 * The FTA return (form VAT 201) does not ask "how much VAT did you charge?" —
 * it asks for supplies split by treatment, with the tax on each. A single
 * contractor's invoice routinely mixes them: standard-rated work on the
 * mainland, a zero-rated export, a designated-zone supply. So treatment sits on
 * the voucher line, and this module turns those lines into the boxes.
 */

export const VAT_RATE = 0.05;

export const VAT_TREATMENTS = [
  "Standard",
  "Zero-rated",
  "Exempt",
  "Out of scope",
  "Reverse charge",
] as const;
export type VatTreatment = (typeof VAT_TREATMENTS)[number];

/** Plain-English help, shown beside the field so nobody has to guess. */
export const TREATMENT_HELP: Record<VatTreatment, string> = {
  Standard: "Normal 5% VAT — most work billed inside the UAE.",
  "Zero-rated": "0% but still a taxable supply — exports outside the GCC, international transport.",
  Exempt: "No VAT and not recoverable — certain financial services, bare land, local passenger transport.",
  "Out of scope": "Outside UAE VAT altogether — supplies made and consumed abroad.",
  "Reverse charge": "You account for the tax yourself on an import — it goes on both sides of the return and nets to nil.",
};

/** Vouchers that make a supply (output tax) and those that incur one (input tax). */
export const OUTPUT_VOUCHERS = new Set(["Sales", "Receipt", "Credit Note"]);
export const INPUT_VOUCHERS = new Set(["Purchase", "Payment", "Debit Note"]);
/** A note adjusts an earlier invoice, so its values carry the opposite sign. */
export const ADJUSTMENT_VOUCHERS = new Set(["Credit Note", "Debit Note"]);

export type VatLine = {
  voucherType: string;
  treatment: string | null;
  /** The net amount of the supply or expense, before tax. */
  taxableValue: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Tax on a taxable value: only standard-rated and reverse-charge lines bear it. */
export function taxOn(treatment: string | null, taxableValue: number): number {
  if (treatment === "Standard" || treatment === "Reverse charge") return round2(taxableValue * VAT_RATE);
  return 0;
}

export type Vat201 = {
  /** Box 1 — standard-rated supplies. */
  standardSupplies: { amount: number; vat: number };
  /** Box 3 — supplies subject to the reverse charge. */
  reverseChargeSupplies: { amount: number; vat: number };
  /** Box 4 — zero-rated supplies. */
  zeroRatedSupplies: number;
  /** Box 5 — exempt supplies. */
  exemptSupplies: number;
  /** Box 9 — standard-rated expenses. */
  standardExpenses: { amount: number; vat: number };
  /** Box 10 — expenses subject to the reverse charge, recoverable. */
  reverseChargeExpenses: { amount: number; vat: number };
  /** Box 12 — total output tax due. */
  outputTax: number;
  /** Box 13 — total input tax recoverable. */
  inputTax: number;
  /** Box 14 — payable to, or refundable by, the FTA. */
  netPayable: number;
  /** Lines carrying tax but no treatment — they cannot be placed in a box. */
  unclassified: number;
};

/**
 * Build the VAT 201 figures from voucher lines.
 *
 * Reverse charge appears on both sides on purpose: you declare the tax as
 * output and reclaim it as input, so it nets to nil while still being
 * declared — which is exactly what the FTA requires on imported services.
 */
export function buildVat201(lines: VatLine[]): Vat201 {
  const box = {
    standardSupplies: { amount: 0, vat: 0 },
    reverseChargeSupplies: { amount: 0, vat: 0 },
    zeroRatedSupplies: 0,
    exemptSupplies: 0,
    standardExpenses: { amount: 0, vat: 0 },
    reverseChargeExpenses: { amount: 0, vat: 0 },
    outputTax: 0,
    inputTax: 0,
    netPayable: 0,
    unclassified: 0,
  };

  for (const l of lines) {
    const isOutput = OUTPUT_VOUCHERS.has(l.voucherType);
    const isInput = INPUT_VOUCHERS.has(l.voucherType);
    if (!isOutput && !isInput) continue;

    // A credit or debit note reverses part of an earlier invoice.
    const sign = ADJUSTMENT_VOUCHERS.has(l.voucherType) ? -1 : 1;
    const value = round2(l.taxableValue * sign);
    const tax = round2(taxOn(l.treatment, l.taxableValue) * sign);

    if (!l.treatment) {
      box.unclassified += Math.abs(value);
      continue;
    }

    if (l.treatment === "Out of scope") continue; // declared nowhere

    if (l.treatment === "Reverse charge") {
      // Declared as output and reclaimed as input, whichever side it arose on.
      box.reverseChargeSupplies.amount += value;
      box.reverseChargeSupplies.vat += tax;
      box.reverseChargeExpenses.amount += value;
      box.reverseChargeExpenses.vat += tax;
      continue;
    }

    if (isOutput) {
      if (l.treatment === "Standard") {
        box.standardSupplies.amount += value;
        box.standardSupplies.vat += tax;
      } else if (l.treatment === "Zero-rated") box.zeroRatedSupplies += value;
      else if (l.treatment === "Exempt") box.exemptSupplies += value;
    } else {
      // Only standard-rated expenses carry recoverable tax.
      if (l.treatment === "Standard") {
        box.standardExpenses.amount += value;
        box.standardExpenses.vat += tax;
      }
    }
  }

  box.outputTax = round2(box.standardSupplies.vat + box.reverseChargeSupplies.vat);
  box.inputTax = round2(box.standardExpenses.vat + box.reverseChargeExpenses.vat);
  box.netPayable = round2(box.outputTax - box.inputTax);

  for (const k of ["standardSupplies", "reverseChargeSupplies", "standardExpenses", "reverseChargeExpenses"] as const) {
    box[k].amount = round2(box[k].amount);
    box[k].vat = round2(box[k].vat);
  }
  box.zeroRatedSupplies = round2(box.zeroRatedSupplies);
  box.exemptSupplies = round2(box.exemptSupplies);
  box.unclassified = round2(box.unclassified);

  return box;
}
