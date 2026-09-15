import "server-only";
import { db } from "./db";
import { documentStem, nextInSeries } from "./docnumber";
import { resolveRoute } from "./approval-engine";
import { priceEstimate } from "./estimate-posting";
import { checkIssue, checkEdit, checkAccept, poVariance } from "./quoting";

/**
 * The quotation: raising it from an estimate, getting it approved, sending it,
 * and turning the customer's order into a job (CRM-13 to CRM-17).
 *
 * Posts nothing. The accounting link is the last step and it is master data
 * rather than a voucher: an accepted quotation creates a Job carrying its
 * contract value and its budget, and revenue reaches the books later, when
 * invoices are raised against that job the way they already are.
 *
 * The total is snapshotted from the estimate at the moment the quotation is
 * raised, and is the one thing here that IS stored rather than computed. That
 * is deliberate and it is the opposite of the rule in estimate-posting: an
 * estimate is a working document and its total must always be live, but a
 * quotation is what the customer was handed, and it must not change under
 * them because somebody carried on editing the estimate afterwards.
 */

export type Failed = { ok: false; error: string };
export type Result<T> = ({ ok: true } & T) | Failed;
export type Outcome = { ok: true } | Failed;

export const QUOTE_DOC_TYPE = "Sales Quotation";

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);

async function nextQuoteNumber(companyId: string): Promise<string> {
  const company = await db.company.findUnique({ where: { id: companyId }, select: { code: true } });
  const stem = documentStem(company?.code ?? "", "QTN");
  const last = await db.quotation.findFirst({
    where: { companyId, number: { startsWith: stem } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return nextInSeries(stem, last?.number);
}

/* ======================================================= raising (CRM-13) */

export type QuoteInput = {
  companyId: string;
  preparedBy: string;
  estimateId: string;
  title?: string | null;
  customerName?: string | null;
  partyId?: string | null;
  validUntil?: string | null;
  terms?: string | null;
  notes?: string | null;
};

/**
 * Raise a quotation from an estimate.
 *
 * The price comes from the estimate and there is no way to override it. That
 * is the whole point of having built the estimate up: a quotation with a typed
 * total is a number somebody remembered, and the build-up behind it becomes
 * decoration.
 */
export async function createQuotation(
  input: QuoteInput,
): Promise<Result<{ quotationId: string; number: string; total: number }>> {
  const estimate = await db.estimate.findFirst({
    where: { id: input.estimateId, companyId: input.companyId },
    include: {
      lead: { select: { id: true, partyId: true, customerName: true, title: true } },
      lines: { include: { takeoffs: true } },
    },
  });
  if (!estimate) return { ok: false, error: "That estimate is not in this company." };
  if (estimate.status === "Superseded") {
    return { ok: false, error: "That estimate has been superseded. Quote from the one that replaced it." };
  }

  const totals = priceEstimate(estimate);
  if (totals.cost <= 0) {
    return { ok: false, error: "That estimate has not been costed, so there is no price to quote." };
  }
  if (totals.profit < 0 && !estimate.acceptLoss) {
    return {
      ok: false,
      error: "That estimate quotes below cost. Put the price up, or mark it as a deliberate loss leader first.",
    };
  }

  const customerName =
    String(input.customerName ?? "").trim() || estimate.lead?.customerName || "";
  if (!customerName) {
    return { ok: false, error: "Say who the quotation is for." };
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const number = await nextQuoteNumber(input.companyId);
    try {
      const created = await db.quotation.create({
        data: {
          companyId: input.companyId,
          number,
          status: "Draft",
          revision: 1,
          leadId: estimate.leadId,
          estimateId: estimate.id,
          partyId: input.partyId ?? estimate.lead?.partyId ?? null,
          customerName: customerName.slice(0, 200),
          title: String(input.title ?? "").trim().slice(0, 300) || estimate.title,
          // Snapshotted. See the note at the top of this file.
          total: totals.sell,
          costAtQuote: totals.cost,
          budgetHours: totals.labourHours,
          validUntil: input.validUntil ? new Date(input.validUntil + "T00:00:00.000Z") : null,
          terms: input.terms ?? null,
          notes: input.notes ?? null,
          preparedBy: input.preparedBy,
        },
      });
      return { ok: true, quotationId: created.id, number, total: totals.sell };
    } catch (e) {
      if ((e as { code?: string })?.code !== "P2002") throw e;
    }
  }
  return { ok: false, error: "Could not allocate a number. Try again." };
}

/* ===================================================== approval (CRM-14) */

/**
 * Send it to management.
 *
 * Through the same approval engine everything else uses, so the route is the
 * one the client configured rather than a second set of rules living here.
 * The value rides along, because who has to sign depends on how big it is.
 */
export async function submitQuotation(quotationId: string, tenantId: string, by: string): Promise<Outcome> {
  const quote = await db.quotation.findUnique({ where: { id: quotationId } });
  if (!quote) return { ok: false, error: "Not found" };
  if (quote.status !== "Draft") {
    return { ok: false, error: `This quotation is ${quote.status.toLowerCase()}, so it cannot be sent for approval.` };
  }
  if (quote.total <= 0) return { ok: false, error: "There is no price on this quotation yet." };

  const route = await resolveRoute(tenantId, QUOTE_DOC_TYPE, quote.total);
  const approval = await db.approvalRequest.create({
    data: {
      companyId: quote.companyId,
      docType: QUOTE_DOC_TYPE,
      title: `${quote.number} — ${quote.customerName}`,
      amount: quote.total,
      requestedBy: by,
      status: "Pending",
      currentStep: 1,
      steps: {
        create: route.map((r, i) => ({ order: i + 1, roleName: r.role, requiredLevel: r.level, status: "Pending" })),
      },
    },
  });

  await db.quotation.update({
    where: { id: quotationId },
    data: { status: "Awaiting approval", approvalRequestId: approval.id },
  });
  return { ok: true };
}

/** Bring a quotation into line with the approval it is waiting on. */
export async function syncQuoteApproval(quotationId: string): Promise<string> {
  const quote = await db.quotation.findUnique({ where: { id: quotationId } });
  if (!quote?.approvalRequestId || quote.status !== "Awaiting approval") return quote?.status ?? "";

  const approval = await db.approvalRequest.findUnique({
    where: { id: quote.approvalRequestId },
    include: { steps: { orderBy: { order: "desc" } } },
  });
  // A rejection sends it back to Draft rather than to a status of its own: the
  // estimator's next move is to change something and send it again, and a
  // Rejected state they could not edit out of would be a dead end.
  const status =
    approval?.status === "Approved" ? "Approved" : approval?.status === "Rejected" ? "Draft" : quote.status;

  if (status !== quote.status) {
    const signed = approval?.steps.find((s) => s.status === "Approved" && s.decidedBy);
    await db.quotation.update({
      where: { id: quotationId },
      data: {
        status,
        approvedAt: status === "Approved" ? new Date() : null,
        approvedBy: status === "Approved" ? signed?.decidedBy ?? null : null,
        // Back to editable means letting go of the request it was refused on,
        // or it could never be sent again.
        approvalRequestId: status === "Draft" ? null : quote.approvalRequestId,
      },
    });
  }
  return status;
}

/** Pull a quotation back from management before they have decided. */
export async function withdrawQuotation(quotationId: string): Promise<Outcome> {
  const quote = await db.quotation.findUnique({ where: { id: quotationId } });
  if (!quote) return { ok: false, error: "Not found" };
  if (quote.status !== "Awaiting approval") {
    return { ok: false, error: "It is not with management, so there is nothing to pull back." };
  }
  if (quote.approvalRequestId) {
    await db.approvalRequest.update({
      where: { id: quote.approvalRequestId },
      data: { status: "Withdrawn" },
    }).catch(() => {});
  }
  await db.quotation.update({
    where: { id: quotationId },
    data: { status: "Draft", approvalRequestId: null },
  });
  return { ok: true };
}

/* ====================================================== issuing (CRM-15) */

/**
 * Record that the quotation went to the customer.
 *
 * The system does not send the email. There is no mail transport configured in
 * this application, and inventing one that silently does nothing would be
 * worse than saying so: somebody would believe a quotation had gone out when
 * it had not. What this records is the act — when, by whom, to which address —
 * and the printed document is produced from the quotation itself.
 */
export async function issueQuotation(input: {
  quotationId: string;
  issuedTo: string;
  by: string;
}): Promise<Outcome> {
  const quote = await db.quotation.findUnique({ where: { id: input.quotationId } });
  if (!quote) return { ok: false, error: "Not found" };

  const permitted = checkIssue(quote);
  if (!permitted.ok) return permitted;

  const to = String(input.issuedTo ?? "").trim();
  if (!to) return { ok: false, error: "Say who it went to, so there is a record of where it was sent." };

  await db.quotation.update({
    where: { id: input.quotationId },
    data: { status: "Issued", issuedAt: new Date(), issuedBy: input.by, issuedTo: to.slice(0, 200) },
  });

  if (quote.leadId) {
    await db.leadInteraction.create({
      data: {
        leadId: quote.leadId,
        kind: "Quotation sent",
        summary: `Quotation ${quote.number} issued to ${to}`,
        by: input.by,
      },
    });
    // The enquiry has demonstrably reached Quoted, so the pipeline should say
    // so rather than waiting for somebody to move a card.
    await db.lead.update({ where: { id: quote.leadId }, data: { stage: "Quoted" } }).catch(() => {});
  }
  return { ok: true };
}

/* ==================================================== revising (CRM-16) */

/**
 * Replace an issued quotation with a new revision.
 *
 * The old one is superseded rather than deleted, because the customer still
 * has it and the conversation will refer to it.
 */
export async function reviseQuotation(
  quotationId: string,
  by: string,
): Promise<Result<{ quotationId: string; number: string }>> {
  const old = await db.quotation.findUnique({ where: { id: quotationId } });
  if (!old) return { ok: false, error: "Not found" };
  if (old.status === "Superseded") return { ok: false, error: "This has already been replaced." };
  if (old.status === "Accepted") {
    return { ok: false, error: "They have already ordered against this. Raise a new quotation instead." };
  }
  if (!old.estimateId) return { ok: false, error: "There is no estimate behind this to re-price from." };

  const repriced = await createQuotation({
    companyId: old.companyId,
    preparedBy: by,
    estimateId: old.estimateId,
    title: old.title,
    customerName: old.customerName,
    partyId: old.partyId,
    validUntil: iso(old.validUntil),
    terms: old.terms,
    notes: old.notes,
  });
  if (!repriced.ok) return repriced;

  await db.quotation.update({
    where: { id: repriced.quotationId },
    data: { revision: old.revision + 1, supersedesId: old.id },
  });
  await db.quotation.update({ where: { id: quotationId }, data: { status: "Superseded" } });

  return { ok: true, quotationId: repriced.quotationId, number: repriced.number };
}

/* ============================ the customer's order, and the job (CRM-17) */

export type AcceptInput = {
  quotationId: string;
  poNumber: string;
  poDate: string;
  poValue: number;
  poRef?: string | null;
  acknowledged?: boolean;
  by: string;
  /** Left empty to let the job code follow the quotation number. */
  jobCode?: string | null;
};

/**
 * Record the customer's order and turn it into a job.
 *
 * This is where CRM finally touches the rest of the system, and it is master
 * data rather than a posting: the job carries the contract value the customer
 * actually committed to, and a budget taken from the estimate, so job costing
 * has something to compare against from its first day rather than a zero.
 */
export async function acceptQuotation(
  input: AcceptInput,
): Promise<Result<{ jobId: string; jobCode: string; variance: ReturnType<typeof poVariance> }>> {
  const quote = await db.quotation.findUnique({
    where: { id: input.quotationId },
    include: { estimate: { include: { lines: { include: { takeoffs: true } } } } },
  });
  if (!quote) return { ok: false, error: "Not found" };

  if (!String(input.poNumber ?? "").trim()) {
    return { ok: false, error: "Enter their order number. It is what every invoice on this job will quote." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.poDate ?? "")) {
    return { ok: false, error: "Enter the date of their order." };
  }

  const permitted = checkAccept(quote, input.poValue, input.acknowledged);
  if (!permitted.ok) return permitted;

  const variance = poVariance(quote.total, input.poValue);
  const budgetCost = quote.estimate ? priceEstimate(quote.estimate).cost : quote.costAtQuote;

  // The job code follows the quotation unless somebody wants their own.
  const wanted = String(input.jobCode ?? "").trim() || quote.number.replace(/\//g, "-");
  const clash = await db.job.findFirst({ where: { companyId: quote.companyId, code: wanted } });
  if (clash) {
    return { ok: false, error: `There is already a job ${wanted}. Give this one a different code.` };
  }

  const job = await db.job.create({
    data: {
      companyId: quote.companyId,
      code: wanted,
      name: quote.title,
      type: "Contract",
      partyId: quote.partyId,
      // What they committed to, not what was quoted. See lib/quoting.ts.
      contractValue: variance.ordered,
      budgetCost,
      budgetHours: quote.budgetHours,
      status: "Open",
      notes: `From quotation ${quote.number}, their order ${input.poNumber}`,
    },
  });

  await db.quotation.update({
    where: { id: input.quotationId },
    data: {
      status: "Accepted",
      poNumber: String(input.poNumber).trim().slice(0, 100),
      poDate: new Date(input.poDate + "T00:00:00.000Z"),
      poValue: variance.ordered,
      poRef: input.poRef ?? null,
      poAcknowledged: !variance.matches,
      jobId: job.id,
      closedAt: new Date(),
      closedBy: input.by,
    },
  });

  if (quote.leadId) {
    await db.lead.update({
      where: { id: quote.leadId },
      data: { stage: "Won", jobId: job.id, closedAt: new Date(), closedBy: input.by, closedFromStage: "Negotiating" },
    }).catch(() => {});
    await db.leadInteraction.create({
      data: {
        leadId: quote.leadId,
        kind: "Note",
        summary:
          `Won. Their order ${input.poNumber} for ${variance.ordered.toLocaleString()}` +
          `${variance.matches ? "" : ` (${variance.difference > 0 ? "+" : ""}${variance.difference.toLocaleString()} against the quote)`}` +
          `, now job ${job.code}`,
        by: input.by,
      },
    });
  }

  return { ok: true, jobId: job.id, jobCode: job.code, variance };
}

/** They said no. */
export async function declineQuotation(input: {
  quotationId: string;
  reason: string;
  by: string;
}): Promise<Outcome> {
  const quote = await db.quotation.findUnique({ where: { id: input.quotationId } });
  if (!quote) return { ok: false, error: "Not found" };
  if (quote.status !== "Issued") {
    return { ok: false, error: "Only a quotation the customer is holding can be declined." };
  }

  const reason = String(input.reason ?? "").trim();
  if (!reason) {
    return {
      ok: false,
      error:
        "Say why they turned it down. Six months from now the file will say Declined and " +
        "nobody will be able to tell whether it was the price, the programme, or nobody chasing it.",
    };
  }

  await db.quotation.update({
    where: { id: input.quotationId },
    data: { status: "Declined", declinedReason: reason.slice(0, 500), closedAt: new Date(), closedBy: input.by },
  });

  if (quote.leadId) {
    await db.lead.update({
      where: { id: quote.leadId },
      data: {
        stage: "Lost", lostReason: reason.slice(0, 500),
        closedAt: new Date(), closedBy: input.by, closedFromStage: "Quoted",
      },
    }).catch(() => {});
  }
  return { ok: true };
}

/** Whether this quotation can still be changed, for a screen to ask. */
export const canEdit = checkEdit;
