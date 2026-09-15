"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { allow } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { createLead, moveStage, logInteraction, recordVisit, submitReport } from "@/lib/lead-posting";

/**
 * Enquiry actions.
 *
 * Every one of these reads a form and hands it to lib/lead-posting, which is
 * where the rules live. Nothing here decides anything — the same reason the
 * inventory actions do not: a rule inside a form action can only be applied by
 * that form, and Estimation will need these same rules without one.
 */

export type Result = { ok: true } | { ok: false; error: string };

const str = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);
const orNull = (fd: FormData, k: string, max = 200) => str(fd, k, max) || null;
const num = (fd: FormData, k: string) => Number(fd.get(k)) || 0;

/** The session, if this user may act on this company at all. */
async function scoped(companyId: string) {
  const session = await getSession();
  if (!session) return null;
  return session.companies.some((c) => c.id === companyId) ? session : null;
}

/** The company an enquiry belongs to, for the permission check. */
async function companyOf(leadId: string) {
  const lead = await db.lead.findUnique({ where: { id: leadId }, select: { companyId: true } });
  return lead?.companyId ?? "";
}

export async function saveLead(formData: FormData): Promise<Result> {
  if (!(await allow("crm.leads", "create"))) return { ok: false, error: "Not authorised" };
  const companyId = str(formData, "companyId");
  const session = await scoped(companyId);
  if (!session) return { ok: false, error: "No access to this company" };

  const res = await createLead({
    companyId,
    raisedBy: session.user.name,
    title: str(formData, "title", 300),
    customerName: str(formData, "customerName"),
    partyId: orNull(formData, "partyId"),
    source: orNull(formData, "source", 60),
    description: orNull(formData, "description", 2000),
    estimatedValue: num(formData, "estimatedValue"),
    contactName: orNull(formData, "contactName"),
    contactEmail: orNull(formData, "contactEmail"),
    contactPhone: orNull(formData, "contactPhone", 40),
    budgetStated: str(formData, "budgetStated") ? num(formData, "budgetStated") : null,
    decisionMaker: orNull(formData, "decisionMaker"),
    requiredBy: orNull(formData, "requiredBy", 10),
    scopeDefined: str(formData, "scopeDefined") === "on",
    competitors: orNull(formData, "competitors", 500),
    ownerName: orNull(formData, "ownerName"),
    notes: orNull(formData, "notes", 1000),
  });
  if (!res.ok) return res;

  await audit({
    action: "Created",
    entity: "Lead",
    entityId: res.leadId,
    summary: `Logged enquiry ${res.number} from ${str(formData, "customerName")}`,
  });
  revalidatePath("/crm");
  return { ok: true };
}

export async function changeStage(formData: FormData): Promise<Result> {
  if (!(await allow("crm.leads", "edit"))) return { ok: false, error: "Not authorised" };
  const leadId = str(formData, "leadId");
  if (!(await scoped(await companyOf(leadId)))) return { ok: false, error: "No access to this enquiry" };
  const session = await getSession();

  const to = str(formData, "to", 40);
  const res = await moveStage({
    leadId,
    to,
    by: session?.user.name ?? "",
    lostReason: orNull(formData, "lostReason", 500),
    lostTo: orNull(formData, "lostTo"),
    note: orNull(formData, "note", 300),
  });
  if (!res.ok) return res;

  await audit({ action: "Updated", entity: "Lead", entityId: leadId, summary: `Moved the enquiry to ${to}` });
  revalidatePath("/crm");
  revalidatePath(`/crm/${leadId}`);
  return { ok: true };
}

export async function addInteraction(formData: FormData): Promise<Result> {
  if (!(await allow("crm.leads", "edit"))) return { ok: false, error: "Not authorised" };
  const leadId = str(formData, "leadId");
  if (!(await scoped(await companyOf(leadId)))) return { ok: false, error: "No access to this enquiry" };
  const session = await getSession();

  const res = await logInteraction({
    leadId,
    kind: str(formData, "kind", 40),
    summary: str(formData, "summary", 500),
    by: session?.user.name ?? "",
    at: orNull(formData, "at", 10),
  });
  if (!res.ok) return res;

  revalidatePath(`/crm/${leadId}`);
  return { ok: true };
}

export async function addVisit(formData: FormData): Promise<Result> {
  if (!(await allow("crm.leads", "edit"))) return { ok: false, error: "Not authorised" };
  const leadId = str(formData, "leadId");
  if (!(await scoped(await companyOf(leadId)))) return { ok: false, error: "No access to this enquiry" };
  const session = await getSession();

  const res = await recordVisit({
    leadId,
    visitedOn: str(formData, "visitedOn", 10),
    visitedBy: str(formData, "visitedBy", 120),
    findings: orNull(formData, "findings", 4000),
    reportRef: orNull(formData, "reportRef", 300),
    by: session?.user.name ?? "",
  });
  if (!res.ok) return res;

  await audit({ action: "Created", entity: "SiteVisit", entityId: res.visitId, summary: "Recorded a site visit" });
  revalidatePath(`/crm/${leadId}`);
  revalidatePath("/crm");
  return { ok: true };
}

export async function fileReport(formData: FormData): Promise<Result> {
  if (!(await allow("crm.leads", "edit"))) return { ok: false, error: "Not authorised" };
  const visitId = str(formData, "visitId");
  const visit = await db.siteVisit.findUnique({ where: { id: visitId }, select: { leadId: true } });
  if (!visit) return { ok: false, error: "Not found" };
  if (!(await scoped(await companyOf(visit.leadId)))) return { ok: false, error: "No access to this enquiry" };
  const session = await getSession();

  const res = await submitReport({
    visitId,
    findings: str(formData, "findings", 4000),
    reportRef: orNull(formData, "reportRef", 300),
    by: session?.user.name ?? "",
  });
  if (!res.ok) return res;

  await audit({ action: "Updated", entity: "SiteVisit", entityId: visitId, summary: "Filed the site report" });
  revalidatePath(`/crm/${visit.leadId}`);
  revalidatePath("/crm");
  return { ok: true };
}
