import "server-only";
import { db } from "./db";
import { financePolicyFor } from "./accounts";
import {
  buildUbl, checkTransmittable, type EInvoiceDoc, type EInvoiceSettings, type EInvoiceProblem,
} from "./einvoice";

/**
 * Handing a document to an Accredited Service Provider.
 *
 * One interface, so the provider can be changed without touching anything else.
 * That is not speculative tidiness: ASPs get accredited, merge and change their
 * pricing, this is sold to more than one customer, and each of them may pick a
 * different one. The adapter is the only place that should know which.
 *
 * There is no real provider here yet, and there deliberately is not one. Until
 * an ASP is chosen its API shape is unknown, and inventing an HTTP call to an
 * imaginary endpoint would be code that has never worked and cannot be tested.
 * What exists is the seam, the document, and a provider that says plainly that
 * none is configured.
 */

export type TransmitResult =
  | { ok: true; reference: string; status: "Sent" | "Accepted" }
  | { ok: false; error: string; retryable: boolean };

export type AspProvider = {
  /** Shown on screen, so somebody can tell who to ring. */
  name: string;
  /** Hand over one document. */
  send(xml: string, doc: EInvoiceDoc): Promise<TransmitResult>;
};

/**
 * What runs until an ASP is chosen and its adapter written.
 *
 * It refuses rather than pretending. A provider that silently succeeded would
 * mark documents as transmitted that no tax authority has ever seen, which is
 * the worst outcome available here — it would be discovered at an audit.
 */
export const NOT_CONFIGURED: AspProvider = {
  name: "None configured",
  async send() {
    return {
      ok: false,
      retryable: false,
      error:
        "No accredited service provider is configured, so nothing was sent. " +
        "Set one up on Finance → Setup → Finance Settings once you have appointed one.",
    };
  },
};

/** Providers this build knows how to talk to, by the name stored on the policy. */
const PROVIDERS: Record<string, AspProvider> = {
  // Populated when an ASP is appointed and its adapter is written.
};

export function providerFor(name: string | null | undefined): AspProvider {
  if (!name) return NOT_CONFIGURED;
  return PROVIDERS[name] ?? NOT_CONFIGURED;
}

/* ==================== turning an invoice into a document ================ */

export async function settingsFor(companyId: string): Promise<EInvoiceSettings & { provider: string | null }> {
  const policy = await financePolicyFor(companyId);
  return {
    customizationId: policy.eInvoiceCustomizationId ?? "",
    profileId: policy.eInvoiceProfileId,
    provider: policy.eInvoiceProvider || null,
  };
}

/** Read an issued invoice into the shape the document builder wants. */
export async function documentFor(invoiceId: string): Promise<EInvoiceDoc | null> {
  const inv = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      lines: { orderBy: { order: "asc" } },
      company: true,
      originalInvoice: { select: { number: true, issueDate: true } },
    },
  });
  if (!inv) return null;

  return {
    number: inv.number,
    docType: inv.docType,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    currency: inv.currency,
    // The seller's own details as snapshotted at issue, falling back to the
    // company record for a document raised before those columns existed.
    seller: {
      name: inv.company.name,
      trn: inv.sellerTrn ?? inv.company.vatTRN,
      addressLine: inv.company.addressLine,
      city: inv.company.city,
      emirate: inv.company.emirate,
      countryCode: inv.company.countryCode,
    },
    buyer: {
      name: inv.partyName,
      trn: inv.partyTrn,
      addressLine: inv.partyAddress,
      countryCode: "AE",
    },
    lines: inv.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitCode: l.unitCode,
      unitPrice: l.unitPrice,
      discount: l.discount,
      netAmount: l.netAmount,
      vatTreatment: l.vatTreatment,
      vatRate: l.vatRate,
      vatAmount: l.vatAmount,
    })),
    netTotal: inv.netTotal,
    vatTotal: inv.vatTotal,
    grossTotal: inv.grossTotal,
    taxBreakdown: JSON.parse(inv.taxBreakdown || "[]"),
    notes: inv.notes,
    precedingNumber: inv.originalInvoice?.number ?? null,
    precedingDate: inv.originalInvoice?.issueDate ?? null,
  };
}

export type PrepareResult =
  | { ok: true; xml: string; doc: EInvoiceDoc }
  | { ok: false; error: string; problems?: EInvoiceProblem[] };

/**
 * Build and check the document, without sending it.
 *
 * Separated from sending so the screen can show a person exactly what would go,
 * before anything leaves. A document nobody has ever looked at is a document
 * nobody can defend.
 */
export async function prepare(invoiceId: string): Promise<PrepareResult> {
  const doc = await documentFor(invoiceId);
  if (!doc) return { ok: false, error: "Invoice not found." };

  const inv = await db.invoice.findUnique({ where: { id: invoiceId }, select: { companyId: true, status: true } });
  if (inv?.status !== "Issued") {
    return { ok: false, error: "Only an issued invoice can be transmitted. A draft is not a tax invoice." };
  }

  const settings = await settingsFor(inv.companyId);
  const problems = checkTransmittable(doc, settings);
  if (problems.length > 0) {
    return {
      ok: false,
      error: `This document would be rejected — ${problems.length} thing${problems.length === 1 ? "" : "s"} to fix first.`,
      problems,
    };
  }

  return { ok: true, xml: buildUbl(doc, settings), doc };
}

/**
 * Send it, and record what happened.
 *
 * The transmitted XML is stored whatever the outcome. What was sent is what has
 * to be produced on request, and rebuilding it later from current code would
 * produce whatever the code says today rather than what the provider received.
 */
export async function transmit(invoiceId: string, by: string): Promise<TransmitResult> {
  const prepared = await prepare(invoiceId);
  if (!prepared.ok) {
    await db.invoice.update({
      where: { id: invoiceId },
      data: {
        eInvoiceStatus: "Failed",
        eInvoiceError: prepared.error,
        eInvoiceAttempts: { increment: 1 },
      },
    });
    return { ok: false, error: prepared.error, retryable: true };
  }

  const inv = await db.invoice.findUnique({ where: { id: invoiceId }, select: { companyId: true } });
  const settings = await settingsFor(inv!.companyId);
  const provider = providerFor(settings.provider);

  await db.invoice.update({
    where: { id: invoiceId },
    data: { eInvoiceStatus: "Queued", eInvoiceXml: prepared.xml, eInvoiceAttempts: { increment: 1 } },
  });

  let result: TransmitResult;
  try {
    result = await provider.send(prepared.xml, prepared.doc);
  } catch (err) {
    // A provider that throws is a provider that is down, not a document that is
    // wrong. The difference decides whether retrying is sensible.
    result = {
      ok: false,
      retryable: true,
      error: `${provider.name} could not be reached: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  await db.invoice.update({
    where: { id: invoiceId },
    data: result.ok
      ? {
          eInvoiceStatus: result.status,
          eInvoiceRef: result.reference,
          eInvoiceSentAt: new Date(),
          eInvoiceAckAt: result.status === "Accepted" ? new Date() : null,
          eInvoiceError: null,
        }
      : { eInvoiceStatus: result.retryable ? "Failed" : "Rejected", eInvoiceError: result.error },
  });

  return result;
}

/**
 * Invoices that should have been transmitted and have not been.
 *
 * The question a finance manager needs answered in one glance, because under
 * this model nothing tells you: a document can sit in Failed for a week and
 * everything else in the system looks perfectly normal.
 */
export async function outstandingTransmissions(companyId: string) {
  return db.invoice.findMany({
    where: {
      companyId,
      side: "Sales",
      status: "Issued",
      eInvoiceStatus: { in: ["Not applicable", "Ready", "Queued", "Failed", "Rejected"] },
    },
    orderBy: { issueDate: "asc" },
    select: {
      id: true, number: true, docType: true, issueDate: true, partyName: true,
      grossTotal: true, eInvoiceStatus: true, eInvoiceError: true, eInvoiceAttempts: true,
    },
  });
}
