import "server-only";
import { db } from "./db";
import { documentStem, nextInSeries } from "./docnumber";
import { serialised, seriesKey, isUniqueClash, isBusy, BUSY_MESSAGE, type Client } from "./serialise";
import { checkStageChange, type LeadLike } from "./leads";

/**
 * Enquiries: raising them, moving them, and keeping the history.
 *
 * Posts nothing to the ledger, on purpose. An enquiry is a conversation, not a
 * transaction — nothing is owed and nothing is owned because somebody rang up.
 * The accounting link arrives only when a won enquiry becomes a job, and even
 * that is master data rather than a voucher: revenue reaches the books when
 * invoices are raised against that job, the way they already are.
 *
 * Every stage change writes an interaction. The history is the point of a CRM
 * — a pipeline tells you where things are, and only the history tells you why.
 */

export type Failed = { ok: false; error: string };
export type Result<T> = ({ ok: true } & T) | Failed;
export type Outcome = { ok: true } | Failed;

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);

async function nextLeadNumber(companyId: string, client: Client = db): Promise<string> {
  const company = await db.company.findUnique({ where: { id: companyId }, select: { code: true } });
  const stem = documentStem(company?.code ?? "", "ENQ");
  const last = await client.lead.findFirst({
    where: { companyId, number: { startsWith: stem } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return nextInSeries(stem, last?.number);
}

/**
 * A stored lead in the shape the rules read.
 *
 * `siteReportOn` is the whole reason this exists: it is derived from a visit
 * that actually has a report on it, never stored on the lead. A status column
 * would say "Site Report Submitted" from the moment somebody booked the visit,
 * and stay saying it if the report never arrived.
 */
export type StoredLead = {
  stage: string;
  estimatedValue: number;
  budgetStated: number | null;
  decisionMaker: string | null;
  requiredBy: Date | null;
  scopeDefined: boolean;
  visits?: { reportOn: Date | null }[];
};

export function toLeadLike(lead: StoredLead): LeadLike {
  const reports = (lead.visits ?? []).map((v) => v.reportOn).filter(Boolean) as Date[];
  reports.sort((a, b) => +a - +b);
  return {
    stage: lead.stage,
    estimatedValue: lead.estimatedValue,
    budgetStated: lead.budgetStated,
    decisionMaker: lead.decisionMaker,
    requiredBy: iso(lead.requiredBy),
    siteReportOn: reports.length ? iso(reports[0]) : null,
    scopeDefined: lead.scopeDefined,
  };
}

/* ============================================================== raising == */

export type LeadInput = {
  companyId: string;
  raisedBy: string;
  title: string;
  customerName: string;
  partyId?: string | null;
  source?: string | null;
  description?: string | null;
  estimatedValue?: number;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  budgetStated?: number | null;
  decisionMaker?: string | null;
  requiredBy?: string | null;
  scopeDefined?: boolean;
  competitors?: string | null;
  ownerName?: string | null;
  notes?: string | null;
};

export async function createLead(input: LeadInput): Promise<Result<{ leadId: string; number: string }>> {
  const title = String(input.title ?? "").trim();
  if (!title) return { ok: false, error: "Say what the enquiry is for." };

  const customerName = String(input.customerName ?? "").trim();
  if (!customerName) return { ok: false, error: "Say who it is from, even if they are not a customer yet." };

  if (input.partyId && !(await db.party.findFirst({ where: { id: input.partyId, companyId: input.companyId } }))) {
    return { ok: false, error: "That customer is not in this company." };
  }
  if (Number(input.estimatedValue ?? 0) < 0) return { ok: false, error: "A value cannot be negative." };

  // Numbered while holding the series lock, so simultaneous callers queue for a
  // moment instead of colliding; the retry is for anything numbering without it.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { created, number } = await serialised([seriesKey(input.companyId, "ENQ")], async (client) => {
        const number = await nextLeadNumber(input.companyId, client);
        const created = await client.lead.create({
        data: {
          companyId: input.companyId,
          number,
          title: title.slice(0, 300),
          stage: "New",
          source: input.source ?? null,
          partyId: input.partyId || null,
          customerName: customerName.slice(0, 200),
          contactName: input.contactName ?? null,
          contactEmail: input.contactEmail ?? null,
          contactPhone: input.contactPhone ?? null,
          description: input.description ?? null,
          estimatedValue: Number(input.estimatedValue) || 0,
          budgetStated: input.budgetStated == null ? null : Number(input.budgetStated),
          decisionMaker: input.decisionMaker ?? null,
          requiredBy: input.requiredBy ? new Date(input.requiredBy + "T00:00:00.000Z") : null,
          scopeDefined: !!input.scopeDefined,
          competitors: input.competitors ?? null,
          ownerName: input.ownerName || input.raisedBy,
          notes: input.notes ?? null,
          interactions: {
            create: {
              kind: "Note",
              summary: `Enquiry logged from ${customerName}`,
              by: input.raisedBy,
            },
          },
        },
        });
        return { created, number };
      });
      return { ok: true, leadId: created.id, number };
    } catch (e) {
      if (isBusy(e)) return { ok: false, error: BUSY_MESSAGE };
      if (!isUniqueClash(e)) throw e;
    }
  }
  return { ok: false, error: "Could not allocate a number. Try again." };
}

/* ============================================================== moving === */

export type StageInput = {
  leadId: string;
  to: string;
  by: string;
  lostReason?: string | null;
  lostTo?: string | null;
  note?: string | null;
};

/**
 * Move an enquiry to another stage.
 *
 * Writes an interaction whichever way it goes, because a stage on its own
 * says where something is and the history says why it got there — and "why"
 * is the only part anybody wants six months later.
 */
export async function moveStage(input: StageInput): Promise<Outcome> {
  const lead = await db.lead.findUnique({ where: { id: input.leadId }, include: { visits: true } });
  if (!lead) return { ok: false, error: "Not found" };

  const permitted = checkStageChange(toLeadLike(lead), input.to, {
    lostReason: input.lostReason,
    lostTo: input.lostTo,
  });
  if (!permitted.ok) return permitted;

  const closing = input.to === "Won" || input.to === "Lost";
  await db.lead.update({
    where: { id: input.leadId },
    data: {
      stage: input.to,
      lostReason: input.to === "Lost" ? String(input.lostReason ?? "").trim() : lead.lostReason,
      lostTo: input.to === "Lost" ? input.lostTo ?? null : lead.lostTo,
      closedAt: closing ? new Date() : null,
      closedBy: closing ? input.by : null,
      // Where it had got to when it stopped, so the tracker can show how far it
      // went rather than implying every closed enquiry went the whole way.
      closedFromStage: closing ? lead.stage : null,
    },
  });

  const summary =
    input.to === "Lost"
      ? `Lost${input.lostTo ? ` to ${input.lostTo}` : ""} — ${String(input.lostReason ?? "").trim()}`
      : `Moved from ${lead.stage} to ${input.to}${input.note ? ` — ${input.note}` : ""}`;

  await db.leadInteraction.create({
    data: { leadId: input.leadId, kind: "Note", summary: summary.slice(0, 500), by: input.by },
  });
  return { ok: true };
}

/* ========================================================= the history == */

export const INTERACTION_KINDS = ["Call", "Email", "Meeting", "Site visit", "Quotation sent", "Note"] as const;

export async function logInteraction(input: {
  leadId: string;
  kind: string;
  summary: string;
  by: string;
  at?: string | null;
}): Promise<Outcome> {
  const lead = await db.lead.findUnique({ where: { id: input.leadId }, select: { id: true } });
  if (!lead) return { ok: false, error: "Not found" };

  const summary = String(input.summary ?? "").trim();
  if (!summary) return { ok: false, error: "Say what was said. An entry with no words in it is not a history." };
  if (!(INTERACTION_KINDS as readonly string[]).includes(input.kind)) {
    return { ok: false, error: "Choose what kind of contact this was." };
  }

  await db.leadInteraction.create({
    data: {
      leadId: input.leadId,
      kind: input.kind,
      summary: summary.slice(0, 500),
      by: input.by,
      at: input.at ? new Date(input.at + "T00:00:00.000Z") : new Date(),
    },
  });
  return { ok: true };
}

/* ========================================================= site visits == */

/**
 * Record that somebody went, or is going (CRM-12).
 *
 * The findings are optional here because a visit and its report are two
 * events. Booking Tuesday's visit on Monday is ordinary, and the enquiry
 * should show that somebody is going without claiming a report exists.
 */
export async function recordVisit(input: {
  leadId: string;
  visitedOn: string;
  visitedBy: string;
  findings?: string | null;
  reportRef?: string | null;
  by: string;
}): Promise<Result<{ visitId: string }>> {
  const lead = await db.lead.findUnique({ where: { id: input.leadId } });
  if (!lead) return { ok: false, error: "Not found" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.visitedOn ?? "")) return { ok: false, error: "Enter the date of the visit." };
  if (!String(input.visitedBy ?? "").trim()) return { ok: false, error: "Say who went." };

  const findings = String(input.findings ?? "").trim();
  const visit = await db.siteVisit.create({
    data: {
      leadId: input.leadId,
      visitedOn: new Date(input.visitedOn + "T00:00:00.000Z"),
      visitedBy: input.visitedBy.trim().slice(0, 120),
      findings: findings || null,
      // The report date is set by the report existing, not by anybody saying so.
      reportOn: findings ? new Date() : null,
      reportRef: input.reportRef ?? null,
    },
  });

  await db.leadInteraction.create({
    data: {
      leadId: input.leadId,
      kind: "Site visit",
      summary: findings
        ? `Visited site on ${input.visitedOn} — report filed`
        : `Site visit recorded for ${input.visitedOn} — report still to come`,
      by: input.by,
    },
  });
  return { ok: true, visitId: visit.id };
}

/** Write up a visit that has already happened. */
export async function submitReport(input: {
  visitId: string;
  findings: string;
  reportRef?: string | null;
  by: string;
}): Promise<Outcome> {
  const visit = await db.siteVisit.findUnique({ where: { id: input.visitId } });
  if (!visit) return { ok: false, error: "Not found" };

  const findings = String(input.findings ?? "").trim();
  if (!findings) {
    return {
      ok: false,
      error:
        "Write what was found. The report is what the estimate gets built on, " +
        "and an empty one would mark the enquiry as reported when nothing was.",
    };
  }

  await db.siteVisit.update({
    where: { id: input.visitId },
    data: { findings: findings.slice(0, 4000), reportOn: visit.reportOn ?? new Date(), reportRef: input.reportRef ?? visit.reportRef },
  });
  await db.leadInteraction.create({
    data: {
      leadId: visit.leadId,
      kind: "Site visit",
      summary: `Site report filed for the visit on ${iso(visit.visitedOn)}`,
      by: input.by,
    },
  });
  return { ok: true };
}

/** Every open enquiry, shaped for the pipeline board. */
export async function openLeads(companyId: string) {
  return db.lead.findMany({
    where: { companyId, stage: { notIn: ["Won", "Lost"] } },
    include: { visits: { select: { reportOn: true } } },
    orderBy: [{ estimatedValue: "desc" }],
  });
}
