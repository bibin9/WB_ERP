"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allowIn } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { toFils } from "@/lib/money";
import {
  DOC_TYPES, INVOICE_SIDES, UNIT_CODES, DEFAULT_UNIT_CODE, dueDateFrom,
  type DocType, type InvoiceSide,
} from "@/lib/invoice";
import { VAT_TREATMENTS } from "@/lib/vat";
import { issueInvoice, refreshInvoiceTotals, nextInvoiceNumber } from "@/lib/invoice-posting";

/**
 * Creating and issuing invoices.
 *
 * The shape here is deliberately not "read a form". Quotations, progress claims
 * and delivery notes are all supposed to become invoices later, and every one
 * of them will want to hand over lines it already has rather than build a
 * FormData to be parsed back apart. So the work is in createInvoice(), which
 * takes a plain object, and the form action is a thin wrapper that turns a
 * form into one.
 */

export type NewInvoiceLine = {
  description: string;
  quantity: number;
  unitCode: string;
  unitPrice: number;
  discount?: number;
  vatTreatment: string;
  accountId: string;
  jobId?: string | null;
  costCentreId?: string | null;
};

export type NewInvoice = {
  companyId: string;
  side: InvoiceSide;
  docType: DocType;
  /** Ours is generated. A supplier's bill carries the supplier's number. */
  number?: string;
  issueDate: string;
  partyId: string;
  jobId?: string | null;
  originalInvoiceId?: string | null;
  notes?: string | null;
  lines: NewInvoiceLine[];
};

export type Result = { ok: true; id: string } | { ok: false; error: string };

const clean = (l: NewInvoiceLine, i: number) => ({
  description: String(l.description ?? "").trim().slice(0, 500),
  quantity: Math.max(0, Number(l.quantity) || 0),
  unitCode: UNIT_CODES.some((u) => u.code === l.unitCode) ? l.unitCode : DEFAULT_UNIT_CODE,
  unitPrice: toFils(Math.max(0, Number(l.unitPrice) || 0)),
  discount: toFils(Math.max(0, Number(l.discount) || 0)),
  vatTreatment: (VAT_TREATMENTS as readonly string[]).includes(l.vatTreatment) ? l.vatTreatment : "Standard",
  accountId: l.accountId,
  jobId: l.jobId || null,
  costCentreId: l.costCentreId || null,
  order: i,
});

/**
 * Start a draft. Nothing is posted until it is issued.
 *
 * Exported for the form and for whatever raises invoices later — a progress
 * claim converting itself is the same call with different lines.
 */
export async function createInvoice(input: NewInvoice): Promise<Result> {
  const session = await allowIn(input.companyId, "finance.invoices", "create");
  if (!session) return { ok: false, error: "Not authorised" };

  if (!input.partyId) return { ok: false, error: "Choose the customer or supplier." };
  const party = await db.party.findFirst({ where: { id: input.partyId, companyId: input.companyId } });
  if (!party) return { ok: false, error: "That customer or supplier is not on this company." };

  const side: InvoiceSide = INVOICE_SIDES.includes(input.side) ? input.side : "Sales";
  const docType: DocType = DOC_TYPES.includes(input.docType) ? input.docType : "Invoice";

  const issueDate = new Date(`${input.issueDate}T00:00:00.000Z`);
  if (Number.isNaN(issueDate.getTime())) return { ok: false, error: "Enter a valid date." };

  // Our own documents are numbered by us; a supplier's bill keeps the number
  // the supplier put on it, which is what an auditor will look for.
  const number =
    side === "Sales"
      ? await nextInvoiceNumber(input.companyId, docType)
      : String(input.number ?? "").trim();
  if (!number) return { ok: false, error: "Enter the supplier's invoice number." };

  const accountIds = [...new Set(input.lines.map((l) => l.accountId).filter(Boolean))];
  const valid = await db.chartOfAccount.findMany({
    where: { id: { in: accountIds }, companyId: input.companyId },
    select: { id: true },
  });
  if (valid.length !== accountIds.length) {
    return { ok: false, error: "One of the lines points at an account on another company." };
  }

  const created = await db.invoice.create({
    data: {
      companyId: input.companyId,
      side, docType, status: "Draft",
      number,
      issueDate,
      dueDate: dueDateFrom(issueDate, party.creditDays),
      partyId: party.id,
      partyName: party.name,
      partyTrn: party.trn,
      jobId: input.jobId || null,
      originalInvoiceId: input.originalInvoiceId || null,
      notes: input.notes?.trim() || null,
      createdBy: session.user.name,
      lines: { create: input.lines.map(clean) },
    },
  });

  await refreshInvoiceTotals(created.id);
  await audit({
    action: "Created", entity: "Invoice", entityId: created.id,
    summary: `${docType} ${number} for ${party.name} — draft.`,
  });
  revalidatePath("/finance/invoices");
  return { ok: true, id: created.id };
}

/** The form's way in. Lines arrive as parallel arrays, the way a table posts. */
export async function createInvoiceFromForm(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const get = (k: string) => String(formData.get(k) ?? "").trim();

  // createInvoice() checks this too. Repeating it here is deliberate: a reader
  // of this function should not have to follow a call to find out whether it is
  // guarded, and neither should the check that walks these files.
  if (!(await allowIn(get("companyId"), "finance.invoices", "create"))) return "Not authorised";

  const all = (k: string) => formData.getAll(k).map((v) => String(v));

  const descriptions = all("description");
  const lines: NewInvoiceLine[] = descriptions.map((description, i) => ({
    description,
    quantity: Number(all("quantity")[i] ?? 0),
    unitCode: all("unitCode")[i] ?? DEFAULT_UNIT_CODE,
    unitPrice: Number(all("unitPrice")[i] ?? 0),
    discount: Number(all("discount")[i] ?? 0),
    vatTreatment: all("vatTreatment")[i] ?? "Standard",
    accountId: all("accountId")[i] ?? "",
    jobId: all("lineJobId")[i] || null,
  })).filter((l) => l.description || l.unitPrice > 0);

  if (lines.length === 0) return "Add at least one line before saving.";

  const res = await createInvoice({
    companyId: get("companyId"),
    side: get("side") as InvoiceSide,
    docType: get("docType") as DocType,
    number: get("number"),
    issueDate: get("issueDate"),
    partyId: get("partyId"),
    jobId: get("jobId") || null,
    originalInvoiceId: get("originalInvoiceId") || null,
    notes: get("notes"),
    lines,
  });
  return res.ok ? undefined : res.error;
}

/** Replace a draft's lines and header. An issued document cannot be edited. */
export async function updateInvoice(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const id = String(formData.get("id") ?? "");
  const existing = await db.invoice.findUnique({ where: { id } });
  if (!existing) return "Invoice not found.";
  const session = await allowIn(existing.companyId, "finance.invoices", "edit");
  if (!session) return "Not authorised";
  if (existing.status !== "Draft") return "An issued invoice cannot be changed. Raise a credit note instead.";

  const all = (k: string) => formData.getAll(k).map((v) => String(v));
  const lines: NewInvoiceLine[] = all("description").map((description, i) => ({
    description,
    quantity: Number(all("quantity")[i] ?? 0),
    unitCode: all("unitCode")[i] ?? DEFAULT_UNIT_CODE,
    unitPrice: Number(all("unitPrice")[i] ?? 0),
    discount: Number(all("discount")[i] ?? 0),
    vatTreatment: all("vatTreatment")[i] ?? "Standard",
    accountId: all("accountId")[i] ?? "",
    jobId: all("lineJobId")[i] || null,
  })).filter((l) => l.description || l.unitPrice > 0);

  if (lines.length === 0) return "An invoice needs at least one line.";

  const issueDate = new Date(`${String(formData.get("issueDate") ?? "")}T00:00:00.000Z`);
  if (Number.isNaN(issueDate.getTime())) return "Enter a valid date.";
  const party = await db.party.findFirst({
    where: { id: String(formData.get("partyId") ?? ""), companyId: existing.companyId },
  });
  if (!party) return "Choose the customer or supplier.";

  await db.$transaction([
    db.invoiceLine.deleteMany({ where: { invoiceId: id } }),
    db.invoice.update({
      where: { id },
      data: {
        issueDate,
        dueDate: dueDateFrom(issueDate, party.creditDays),
        partyId: party.id, partyName: party.name, partyTrn: party.trn,
        jobId: String(formData.get("jobId") ?? "") || null,
        notes: String(formData.get("notes") ?? "").trim() || null,
        lines: { create: lines.map(clean) },
      },
    }),
  ]);

  await refreshInvoiceTotals(id);
  await audit({ action: "Updated", entity: "Invoice", entityId: id, summary: `Draft ${existing.number} edited.` });
  revalidatePath(`/finance/invoices/${id}`);
  return undefined;
}

/** Post it. The document becomes legal and stops being editable. */
export async function issue(id: string): Promise<{ ok: boolean; error?: string; problems?: { field: string; message: string }[] }> {
  const existing = await db.invoice.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Invoice not found." };
  const session = await allowIn(existing.companyId, "finance.invoices", "approve");
  if (!session) return { ok: false, error: "You do not have permission to issue invoices." };

  const res = await issueInvoice(id, session.user.name);
  if (!res.ok) return { ok: false, error: res.error, problems: res.problems };

  await audit({
    action: "Posted", entity: "Invoice", entityId: id,
    summary: `${existing.docType} ${existing.number} issued as ${res.reference}.`,
  });
  revalidatePath(`/finance/invoices/${id}`);
  revalidatePath("/finance/invoices");
  return { ok: true };
}

/**
 * Abandon a draft.
 *
 * Only a draft. An issued invoice is a legal document — the way to undo one is
 * a credit note, which leaves both halves on the record, and deleting it would
 * leave a hole in a numbered series that an auditor will ask about.
 */
export async function cancelDraft(id: string): Promise<Result> {
  const existing = await db.invoice.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Invoice not found." };
  const session = await allowIn(existing.companyId, "finance.invoices", "delete");
  if (!session) return { ok: false, error: "Not authorised" };
  if (existing.status !== "Draft") {
    return { ok: false, error: "An issued invoice cannot be cancelled. Raise a credit note against it." };
  }

  await db.invoice.update({ where: { id }, data: { status: "Cancelled" } });
  await audit({
    action: "Deleted", entity: "Invoice", entityId: id,
    summary: `Draft ${existing.number} cancelled before it was issued.`,
  });
  revalidatePath("/finance/invoices");
  return { ok: true, id };
}
