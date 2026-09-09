import "server-only";
import { db } from "./db";
import { postVoucher } from "./posting";
import { accountsForPosting } from "./accounts";
import { toFils } from "./money";
import {
  invoiceTotals, checkInvoice, type InvoiceLineInput, type DocType, type InvoiceSide,
} from "./invoice";
import { type VatTreatment } from "./vat";

/**
 * Turning an invoice into accounting.
 *
 * The invoice is the document; the voucher is what it did to the books. They
 * are kept apart because the document has to survive independently — an issued
 * invoice may never change, while the ledger it produced is subject to the
 * ordinary rules about closed periods and reversals.
 *
 * Everything still goes through postVoucher(), which is the single seam every
 * module in this system posts through. It owns the voucher numbering, the
 * closed-period lock, the balance check and the concurrency retry, and an
 * invoice has no business reimplementing any of it.
 */

/** What each document does to the books. */
const SIGN: Record<DocType, 1 | -1> = {
  Invoice: 1,
  // A credit note reverses a sale; a debit note adds to it. Both are the same
  // arithmetic with the sign turned round, rather than a second code path that
  // could disagree with the first.
  "Credit Note": -1,
  "Debit Note": 1,
};

const VOUCHER_TYPE: Record<InvoiceSide, Record<DocType, string>> = {
  Sales: { Invoice: "Sales", "Credit Note": "Credit Note", "Debit Note": "Debit Note" },
  Purchase: { Invoice: "Purchase", "Credit Note": "Debit Note", "Debit Note": "Credit Note" },
};

export type IssueResult =
  | { ok: true; invoiceId: string; entryId: string; reference: string }
  | { ok: false; error: string; problems?: { field: string; message: string }[] };

/**
 * Issue a draft invoice: check it, post it, and lock it.
 *
 * The order matters. Nothing is written until the document has passed its own
 * completeness check, because an invoice that cannot be transmitted should
 * never have reached a customer — under the five-corner eInvoicing model a
 * rejection comes back hours later from somebody else's service provider, long
 * after the accountant has moved on.
 */
export async function issueInvoice(invoiceId: string, issuedBy: string): Promise<IssueResult> {
  const inv = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: { lines: { orderBy: { order: "asc" } }, company: true, party: true },
  });
  if (!inv) return { ok: false, error: "Invoice not found." };
  if (inv.status === "Cancelled") return { ok: false, error: "That invoice was cancelled." };
  if (inv.entryId) return { ok: false, error: "That invoice has already been issued." };

  const side = inv.side as InvoiceSide;
  const docType = inv.docType as DocType;

  const lines: InvoiceLineInput[] = inv.lines.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unitCode: l.unitCode,
    unitPrice: l.unitPrice,
    discount: l.discount,
    vatTreatment: l.vatTreatment as VatTreatment,
    accountId: l.accountId,
    jobId: l.jobId,
    costCentreId: l.costCentreId,
  }));

  const original = inv.originalInvoiceId
    ? await db.invoice.findUnique({ where: { id: inv.originalInvoiceId }, select: { number: true } })
    : null;

  const problems = checkInvoice({
    side, docType,
    issueDate: inv.issueDate,
    sellerTrn: inv.company.vatTRN,
    partyName: inv.partyName,
    partyTrn: inv.partyTrn ?? inv.party?.trn ?? null,
    lines,
    originalInvoiceNumber: original?.number ?? null,
  });
  if (problems.length > 0) {
    return {
      ok: false,
      error: `This ${docType.toLowerCase()} is not ready to issue — ${problems.length} thing${problems.length === 1 ? "" : "s"} to fix.`,
      problems,
    };
  }

  // The rate is the company's, and is snapshotted onto every line: if the rate
  // ever moves, an invoice raised today must still show what it was raised at.
  // A reverse-charge purchase needs BOTH VAT accounts, not one: the supplier
  // charges nothing and we account for the tax ourselves on both sides.
  const needsBothVat = side === "Purchase" && lines.some((l) => l.vatTreatment === "Reverse charge");
  const roles = await accountsForPosting(inv.companyId, [
    side === "Sales" ? "accountsReceivable" : "accountsPayable",
    side === "Sales" ? "vatOutput" : "vatInput",
    ...(needsBothVat ? (["vatOutput"] as const) : []),
  ]);
  if (!roles.ok) return { ok: false, error: roles.error };

  const rate = roles.policy.vatRate;
  const totals = invoiceTotals(lines, rate);
  const sign = SIGN[docType];

  // Sales:    Dr receivables gross, Cr each revenue line net, Cr VAT output.
  // Purchase: Dr each cost line net, Dr VAT input, Cr payables gross.
  // A credit note is the same with every side reversed, which the sign does.
  const controlId = side === "Sales" ? roles.ids.accountsReceivable : roles.ids.accountsPayable;
  const vatId = side === "Sales" ? roles.ids.vatOutput : roles.ids.vatInput;

  const voucherLines: {
    accountId: string; debit: number; credit: number;
    vatTreatment?: string | null; jobId?: string | null; costCentreId?: string | null;
  }[] = [];

  const put = (accountId: string, amount: number, side_: "debit" | "credit", extra: Record<string, unknown> = {}) => {
    // A negative amount is the same posting on the other side of the ledger.
    // Letting one through would produce a voucher that balances arithmetically
    // and reads as nonsense.
    const v = toFils(amount * sign);
    if (v === 0) return;
    const onDebit = v > 0 ? side_ === "debit" : side_ === "credit";
    voucherLines.push({
      accountId,
      debit: onDebit ? Math.abs(v) : 0,
      credit: onDebit ? 0 : Math.abs(v),
      ...extra,
    });
  };

  // A sale is money owed to us; a purchase is money we owe. The control
  // account is therefore debited on one and credited on the other.
  put(controlId, totals.gross, side === "Sales" ? "debit" : "credit");
  totals.lines.forEach((t, i) => {
    put(lines[i].accountId!, t.net, side === "Sales" ? "credit" : "debit", {
      vatTreatment: lines[i].vatTreatment,
      jobId: lines[i].jobId ?? null,
      costCentreId: lines[i].costCentreId ?? null,
    });
  });
  put(vatId, totals.vat, side === "Sales" ? "credit" : "debit");

  // Reverse charge on an import: the supplier invoices without tax, and we put
  // the tax on both sides of our own books so it nets to nil in the P&L and
  // appears in both halves of the return. Posting only the payable — which is
  // what "no VAT on the invoice" would otherwise give — understates box 3 and
  // box 10 by the same amount, and an FTA audit reads those boxes.
  if (needsBothVat) {
    const rcNet = totals.lines.reduce(
      (t, l, i) => (lines[i].vatTreatment === "Reverse charge" ? toFils(t + l.net) : t),
      0,
    );
    const rcTax = toFils(rcNet * rate);
    if (rcTax !== 0) {
      put(roles.ids.vatInput, rcTax, "debit", { vatTreatment: "Reverse charge" });
      put(roles.ids.vatOutput, rcTax, "credit", { vatTreatment: "Reverse charge" });
    }
  }

  const posted = await postVoucher({
    companyId: inv.companyId,
    postedBy: issuedBy,
    voucherType: VOUCHER_TYPE[side][docType],
    date: inv.issueDate.toISOString().slice(0, 10),
    partyId: inv.partyId,
    memo: `${docType} ${inv.number}${inv.notes ? ` — ${inv.notes}` : ""}`,
    vatAmount: toFils(totals.vat * sign),
    // The invoice is the source document, so the posting seam's own unique
    // index on (company, sourceType, sourceId) is what stops it being posted
    // twice — including by two people pressing Issue at the same moment.
    sourceType: "invoice",
    sourceId: inv.id,
    lines: voucherLines,
  });
  if (!posted.ok) return { ok: false, error: posted.error };

  await db.invoice.update({
    where: { id: inv.id },
    data: {
      status: "Issued",
      entryId: posted.entryId,
      issuedBy,
      issuedAt: new Date(),
      netTotal: totals.net,
      vatTotal: totals.vat,
      grossTotal: totals.gross,
      taxBreakdown: JSON.stringify(totals.breakdown),
      // Frozen at issue: what was printed must survive a later rename.
      sellerTrn: inv.company.vatTRN,
      sellerAddress: [inv.company.addressLine, inv.company.city, inv.company.emirate]
        .filter(Boolean).join(", ") || null,
      partyTrn: inv.partyTrn ?? inv.party?.trn ?? null,
      partyAddress:
        inv.partyAddress ??
        ([inv.party?.addressLine, inv.party?.city, inv.party?.emirate].filter(Boolean).join(", ") ||
          inv.party?.address ||
          null),
    },
  });

  return { ok: true, invoiceId: inv.id, entryId: posted.entryId, reference: posted.reference };
}

/**
 * Recalculate a draft's totals from its lines.
 *
 * Held on the row rather than computed on every read because a list of two
 * hundred invoices would otherwise load every line to show a total, and because
 * an issued document's figures must be what was issued rather than what the
 * arithmetic says today.
 */
export async function refreshInvoiceTotals(invoiceId: string): Promise<void> {
  const inv = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: { lines: true },
  });
  if (!inv || inv.status === "Issued") return;

  const roles = await accountsForPosting(inv.companyId, []);
  const rate = roles.ok ? roles.policy.vatRate : 0.05;

  const totals = invoiceTotals(
    inv.lines.map((l) => ({
      description: l.description, quantity: l.quantity, unitCode: l.unitCode,
      unitPrice: l.unitPrice, discount: l.discount,
      vatTreatment: l.vatTreatment as VatTreatment, accountId: l.accountId,
    })),
    rate,
  );

  await db.$transaction([
    ...inv.lines.map((l, i) =>
      db.invoiceLine.update({
        where: { id: l.id },
        data: {
          netAmount: totals.lines[i].net,
          vatRate: totals.lines[i].vatRate,
          vatAmount: totals.lines[i].vat,
        },
      }),
    ),
    db.invoice.update({
      where: { id: inv.id },
      data: {
        netTotal: totals.net,
        vatTotal: totals.vat,
        grossTotal: totals.gross,
        taxBreakdown: JSON.stringify(totals.breakdown),
      },
    }),
  ]);
}

/**
 * The next number for a company's own invoices.
 *
 * Purchases keep the supplier's number, so only sales are numbered here. The
 * same read-then-write race that postVoucher() handles applies, and is handled
 * the same way: the unique index on (company, side, number) is the authority,
 * and a clash simply tries the next one.
 */
export async function nextInvoiceNumber(companyId: string, docType: DocType): Promise<string> {
  const company = await db.company.findUnique({ where: { id: companyId }, select: { code: true } });
  const prefix = `${company?.code ?? "INV"}/${docType === "Credit Note" ? "CN" : docType === "Debit Note" ? "DN" : "INV"}/`;
  const last = await db.invoice.findFirst({
    where: { companyId, side: "Sales", docType, number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const n = last ? Number(last.number.slice(prefix.length)) || 0 : 0;
  return `${prefix}${String(n + 1).padStart(5, "0")}`;
}
