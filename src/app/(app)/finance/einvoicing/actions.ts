"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { allowIn } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { prepare, transmit } from "@/lib/einvoice-asp";

/**
 * Transmitting a document to the accredited service provider.
 *
 * Preparing and sending are separate on purpose. A person should be able to see
 * exactly what would leave, and why it would be refused, without anything
 * leaving — under the five-corner model a rejection arrives asynchronously from
 * somebody else's system, after the customer already has the invoice.
 */

export type PreviewResult =
  | { ok: true; xml: string }
  | { ok: false; error: string; problems?: { field: string; message: string }[] };

export async function previewDocument(invoiceId: string): Promise<PreviewResult> {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId }, select: { companyId: true } });
  if (!inv) return { ok: false, error: "Invoice not found." };
  if (!(await allowIn(inv.companyId, "finance.einvoicing", "view"))) {
    return { ok: false, error: "Not authorised" };
  }
  const res = await prepare(invoiceId);
  return res.ok ? { ok: true, xml: res.xml } : { ok: false, error: res.error, problems: res.problems };
}

export async function send(invoiceId: string): Promise<{ ok: boolean; error?: string }> {
  const inv = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: { companyId: true, number: true, docType: true },
  });
  if (!inv) return { ok: false, error: "Invoice not found." };

  // Transmitting is not viewing. It puts a document into a tax authority's
  // hands and cannot be taken back, so it needs the same permission as issuing.
  const session = await allowIn(inv.companyId, "finance.einvoicing", "approve");
  if (!session) return { ok: false, error: "You do not have permission to transmit documents." };

  const res = await transmit(invoiceId, session.user.name);

  await audit({
    action: res.ok ? "Posted" : "Rejected",
    entity: "eInvoice",
    entityId: invoiceId,
    summary: res.ok
      ? `${inv.docType} ${inv.number} transmitted — provider reference ${res.reference}.`
      : `${inv.docType} ${inv.number} not transmitted: ${res.error}`,
  });

  revalidatePath("/finance/einvoicing");
  revalidatePath(`/finance/invoices/${invoiceId}`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}
